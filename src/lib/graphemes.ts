/**
 * The characters of `text` as a person sees them: a flag, a skin-toned or
 * joined emoji, a letter with its accent, each one character. Shared by the
 * sky's composer (its counter) and the server (its cut), so the two agree.
 */
export function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(
    new Segmenter('en', { granularity: 'grapheme' }).segment(text),
    (part) => part.segment,
  );
}
