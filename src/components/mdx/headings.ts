/**
 * Heading utilities for MDX anchor links.
 *
 * Used by `Heading.astro` to slugify heading text into stable, URL-safe ids
 * for in-page anchors (GitHub-style, without a rehype plugin dependency).
 */

/**
 * Convert a rendered-HTML heading body into a URL-safe slug.
 * Strips tags and entities so the slug matches the visible heading text.
 */
export function slugifyHeading(
  renderedHtml: string,
  providedId?: string,
): string {
  const text = renderedHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

  return text || providedId || 'section';
}

export type HeadingLevel = 2 | 3 | 4;
