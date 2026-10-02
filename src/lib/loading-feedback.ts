/** Shared, reference-counted feedback for navigation and foreground requests. */
const pending = new Set<symbol>();
let revealTimer: ReturnType<typeof setTimeout> | undefined;

export function resetLoadingFeedback() {
  pending.clear();
  clearTimeout(revealTimer);
  revealTimer = undefined;
  delete document.documentElement.dataset.loading;
}

export function beginLoading() {
  const token = Symbol();
  pending.add(token);
  if (pending.size === 1) {
    // Fast responses should never flash a loader.
    revealTimer = setTimeout(() => {
      document.documentElement.dataset.loading = 'true';
    }, 140);
  }
  return () => {
    pending.delete(token);
    if (pending.size === 0) resetLoadingFeedback();
  };
}

let finishNavigation: (() => void) | undefined;
let navigationTimeout: ReturnType<typeof setTimeout> | undefined;

export function stopNavigationFeedback() {
  clearTimeout(navigationTimeout);
  finishNavigation?.();
  finishNavigation = undefined;
}

export function beginNavigationFeedback() {
  stopNavigationFeedback();
  finishNavigation = beginLoading();
  // Downloads, cancelled navigations, and browsers without navigation events
  // must not leave the old document permanently showing activity.
  navigationTimeout = setTimeout(stopNavigationFeedback, 15_000);
}

export function isPageNavigation(href: string, current: string) {
  const from = new URL(current);
  const to = new URL(href, from);
  return (
    to.origin === from.origin &&
    /^https?:$/.test(to.protocol) &&
    (to.pathname !== from.pathname || to.search !== from.search)
  );
}

export function installNavigationFeedback() {
  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')
        : null;
    if (
      !link ||
      link.hasAttribute('download') ||
      (link.target && link.target !== '_self') ||
      !isPageNavigation(link.href, location.href)
    )
      return;
    beginNavigationFeedback();
  });
  window.addEventListener('pageshow', () => {
    stopNavigationFeedback();
    resetLoadingFeedback();
  });
  window.addEventListener('pagehide', stopNavigationFeedback);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopNavigationFeedback();
  });
  // Observe native navigation without intercepting it. Includes keyboard,
  // programmatic navigation and back/forward where this API is available.
  const navigation = (
    window as Window & {
      navigation?: EventTarget;
    }
  ).navigation;
  navigation?.addEventListener('navigate', (event) => {
    const next = event as Event & {
      destination: { url: string; sameDocument: boolean };
      downloadRequest: string | null;
      signal: AbortSignal;
    };
    if (
      next.defaultPrevented ||
      next.downloadRequest !== null ||
      next.destination.sameDocument ||
      !isPageNavigation(next.destination.url, location.href)
    )
      return;
    beginNavigationFeedback();
    next.signal.addEventListener('abort', stopNavigationFeedback, {
      once: true,
    });
  });
  navigation?.addEventListener('navigateerror', stopNavigationFeedback);
  navigation?.addEventListener('navigatesuccess', stopNavigationFeedback);
}

/** Hold the first scene for one second and until geometry is ready. */
export function awakenHomepage() {
  const folio = document.querySelector<HTMLElement>('[data-folio]');
  const loader = document.querySelector<HTMLElement>('[data-site-loader]');
  const entry = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  if (!folio || !loader) return;
  delete loader.dataset.initial;
  if (
    entry?.type === 'back_forward' ||
    !document.documentElement.hasAttribute('data-home-awakening')
  ) {
    delete loader.dataset.intro;
    delete loader.dataset.awakening;
    return;
  }

  let finished = false;
  let minimumElapsed = false;
  loader.dataset.intro = '';
  loader.dataset.awakening = '';
  const minimum = setTimeout(() => {
    minimumElapsed = true;
    if (folio.hasAttribute('data-ready')) finish();
  }, 1000);
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(minimum);
    clearTimeout(fallback);
    observer.disconnect();
    delete document.documentElement.dataset.homeAwakening;
    delete loader.dataset.awakening;
    const composition = loader.querySelector<SVGSVGElement>('svg');
    const outline = loader.querySelector('.loading-indicator__island');
    const island = folio.querySelector('[data-folio-island]');
    if (
      composition &&
      outline &&
      island &&
      folio.hasAttribute('data-ready') &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const from = outline.getBoundingClientRect();
      const to = island.getBoundingClientRect();
      if (from.width && to.width) {
        const bounds = composition.getBoundingClientRect();
        composition.style.transformOrigin = `${from.x + from.width / 2 - bounds.x}px ${from.y + from.height / 2 - bounds.y}px`;
        composition.animate(
          [
            { transform: 'translate(0, 0) scale(1)' },
            {
              transform: `translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px) scale(${to.width / from.width})`,
              opacity: 0,
            },
          ],
          { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
      }
    }
    setTimeout(() => {
      delete loader.dataset.intro;
      window.removeEventListener('pagehide', dismiss);
    }, 650);
  };
  const dismiss = () => {
    finish();
    delete loader.dataset.intro;
    delete loader.dataset.awakening;
    loader
      .getAnimations?.({ subtree: true })
      .forEach((animation) => animation.cancel());
  };
  const observer = new MutationObserver(() => {
    if (minimumElapsed && folio.hasAttribute('data-ready')) finish();
  });
  observer.observe(folio, {
    attributes: true,
    attributeFilter: ['data-ready'],
  });
  // Fail open if enhancement or a font request fails; content remains usable.
  const fallback = setTimeout(finish, 8000);
  window.addEventListener('pagehide', dismiss, { once: true });
}
