/**
 * Sanitize user-supplied plain text before it is persisted to shared storage.
 *
 * - Strips HTML/XML tags so admin moderation views can render the value
 *   without accidentally interpreting markup.
 * - Removes C0/C1 control characters (except common whitespace) that can be
 *   used to obscure content or trick log scrapers.
 * - Normalizes unicode (NFKC) so visually-identical sequences collapse to a
 *   canonical form, limiting homoglyph/bidi tricks.
 * - Collapses runs of whitespace into single spaces.
 * - Truncates to `maxLength` (measured on the collapsed string).
 */
export function sanitizePlainText(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  if (maxLength < 0) maxLength = 0;

  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  const normalized = withoutTags.normalize('NFKC');
  const strippedControls = normalized.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    ' ',
  );
  const collapsed = strippedControls.replace(/\s+/g, ' ').trim();

  return collapsed.slice(0, maxLength);
}
