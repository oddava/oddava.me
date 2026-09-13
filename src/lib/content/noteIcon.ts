const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function isEmojiIcon(value: string): boolean {
  return (
    value.length <= 64 &&
    [...graphemes.segment(value)].length === 1 &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
  );
}

export function isImageIcon(value: string): boolean {
  return /^\/images\/notes\/[a-zA-Z0-9_/-]+\.(png|jpg|gif|webp)$/.test(value);
}

export function isNoteIcon(value: unknown): value is string {
  return (
    typeof value === 'string' && (isImageIcon(value) || isEmojiIcon(value))
  );
}
