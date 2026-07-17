/**
 * Heading slug utility for in-page anchors.
 *
 * Used by the note renderer (`src/lib/garden/render.ts`) to turn heading text
 * into stable, URL-safe ids (GitHub-style, without a rehype plugin dependency).
 *
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
