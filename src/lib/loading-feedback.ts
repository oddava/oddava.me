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
