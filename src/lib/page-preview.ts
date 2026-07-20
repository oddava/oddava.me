const NON_PAGE_PREFIXES = ['/admin', '/api', '/fonts', '/images'];
const NON_HTML_FILE =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|mjs|pdf|png|svg|webp|xml)(?:$|\/)/i;

/**
 * Resolve a link to the canonical URL used by the hover-preview cache.
 *
 * Returning `null` keeps the browser enhancement away from links that are not
 * public HTML pages. Hashes are deliberately removed: every section of one
 * page shares the same preview and therefore the same cache entry.
 */
export function previewPageUrl(
  href: string,
  currentHref: string,
): string | null {
  let target: URL;
  let current: URL;

  try {
    current = new URL(currentHref);
    target = new URL(href, current);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(target.protocol)) return null;
  if (target.origin !== current.origin) return null;
  if (
    NON_PAGE_PREFIXES.some(
      (prefix) =>
        target.pathname === prefix || target.pathname.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }
  if (NON_HTML_FILE.test(target.pathname)) return null;
  if (
    target.pathname === current.pathname &&
    target.search === current.search
  ) {
    return null;
  }

  target.hash = '';
  return target.href;
}
