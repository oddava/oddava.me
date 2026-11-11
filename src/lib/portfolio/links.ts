/** True for an absolute http(s) URL: a link that leaves this site. */
export function isExternalHref(href: string | undefined): boolean {
  return href !== undefined && /^https?:\/\//i.test(href);
}

/**
 * Attributes for an anchor: links that leave the site open in a new tab,
 * without handing the new page a reference back to this one. Same-site and
 * mailto links get nothing.
 */
export function externalLinkAttrs(href: string | undefined): {
  target?: '_blank';
  rel?: string;
} {
  return isExternalHref(href)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
}
