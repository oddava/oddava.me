/** Shared, reference-counted feedback for navigation and foreground requests. */
const pending = new Set<symbol>();
let revealTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let shownAt = 0;

/** Fast responses never flash a loader: it appears only after this. */
export const LOADING_REVEAL_DELAY = 200;
/** Once shown, it stays this long, so it reads as a signal, not a flicker. */
export const LOADING_MIN_VISIBLE = 400;

export function resetLoadingFeedback() {
  pending.clear();
  clearTimeout(revealTimer);
  clearTimeout(hideTimer);
  revealTimer = undefined;
  hideTimer = undefined;
  shownAt = 0;
  delete document.documentElement.dataset.loading;
}

function settle() {
  clearTimeout(revealTimer);
  revealTimer = undefined;
  if (!shownAt) {
    resetLoadingFeedback();
    return;
  }
  const remaining = LOADING_MIN_VISIBLE - (Date.now() - shownAt);
  if (remaining <= 0) {
    resetLoadingFeedback();
    return;
  }
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (pending.size === 0) resetLoadingFeedback();
  }, remaining);
}

export function beginLoading() {
  const token = Symbol();
  pending.add(token);
  clearTimeout(hideTimer);
  hideTimer = undefined;
  if (pending.size === 1 && !shownAt) {
    revealTimer = setTimeout(() => {
      shownAt = Date.now();
      document.documentElement.dataset.loading = 'true';
    }, LOADING_REVEAL_DELAY);
  }
  return () => {
    pending.delete(token);
    if (pending.size === 0) settle();
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
