import { describe, expect, it } from 'vitest';
import { sanitizePlainText } from '../src/lib/server/core/sanitize';

describe('sanitizePlainText', () => {
  it('strips HTML tags', () => {
    expect(
      sanitizePlainText('<b>hi</b><script>alert(1)</script> there', 100),
    ).toBe('hi alert(1) there');
  });

  it('collapses multiple whitespace into single spaces', () => {
    expect(sanitizePlainText('a   b\t\nc   d', 100)).toBe('a b c d');
  });

  it('caps the length of the collapsed output', () => {
    expect(sanitizePlainText('abcdefghij', 4)).toBe('abcd');
    expect(sanitizePlainText('a   b   c', 5)).toBe('a b c');
  });

  it('removes C0/C1 control characters', () => {
    expect(sanitizePlainText('a\u0000b\u0007c\u001Fd\u009Fe', 100)).toBe(
      'a b c d e',
    );
  });

  it('normalizes unicode to NFKC', () => {
    // Fullwidth Latin "Ａ" (U+FF21) folds to ASCII "A" under NFKC.
    expect(sanitizePlainText('ＡＢＣ', 100)).toBe('ABC');
  });

  it('returns empty string for non-string input', () => {
    // @ts-expect-error -- verify defensive behavior against bad input
    expect(sanitizePlainText(undefined, 10)).toBe('');
    // @ts-expect-error -- verify defensive behavior against bad input
    expect(sanitizePlainText(null, 10)).toBe('');
  });

  it('returns empty string for tag-only or whitespace-only input', () => {
    expect(sanitizePlainText('<img src=x>', 100)).toBe('');
    expect(sanitizePlainText('   \n\t  ', 100)).toBe('');
  });

  it('preserves legitimate punctuation', () => {
    expect(sanitizePlainText("Hello, world! It's me — again.", 100)).toBe(
      "Hello, world! It's me — again.",
    );
  });

  it('handles maxLength of zero', () => {
    expect(sanitizePlainText('anything', 0)).toBe('');
  });
});
