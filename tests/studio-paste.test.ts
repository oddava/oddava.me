import { describe, expect, it } from 'vitest';
import {
  bareUrl,
  looksLikeMarkdown,
  markdownForSelection,
  planPaste,
} from '../src/components/admin/studioPaste';

describe('bareUrl', () => {
  it('recognises a clipboard holding one address and nothing else', () => {
    expect(bareUrl('https://example.com/a?b=c')).toBe(
      'https://example.com/a?b=c',
    );
    expect(bareUrl('  http://example.com  ')).toBe('http://example.com');
    expect(bareUrl('mailto:someone@example.com')).toBe(
      'mailto:someone@example.com',
    );
  });

  it('declines anything that is not just a link', () => {
    expect(bareUrl('see https://example.com')).toBeNull();
    expect(bareUrl('https://example.com and more')).toBeNull();
    expect(bareUrl('example.com')).toBeNull();
    expect(bareUrl('')).toBeNull();
  });
});

describe('looksLikeMarkdown', () => {
  it('spots source that should be taken as it is', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true);
    expect(looksLikeMarkdown('- one\n- two')).toBe(true);
    expect(looksLikeMarkdown('1. one')).toBe(true);
    expect(looksLikeMarkdown('> quoted')).toBe(true);
    expect(looksLikeMarkdown('```js\nx\n```')).toBe(true);
    expect(looksLikeMarkdown('a [link](https://x.dev) here')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n')).toBe(true);
  });

  it('leaves ordinary prose to be converted from its HTML', () => {
    expect(looksLikeMarkdown('Just a sentence about 3. something.')).toBe(
      false,
    );
    expect(looksLikeMarkdown('')).toBe(false);
  });
});

describe('planPaste', () => {
  it('wraps selected words in a link when the clipboard is a URL', () => {
    const plan = planPaste('https://example.com', 'the docs')!;
    expect(plan.text).toBe('[the docs](https://example.com)');
    // The caret lands past the closing bracket, ready to keep typing.
    expect(plan.text.slice(0, plan.caret)).toBe(
      '[the docs](https://example.com',
    );
  });

  it('inserts a URL plainly when nothing is selected', () => {
    expect(planPaste('https://example.com', '')!.text).toBe(
      'https://example.com',
    );
  });

  it('does not build a link across a line break', () => {
    expect(planPaste('https://example.com', 'one\ntwo')!.text).toBe(
      'https://example.com',
    );
  });

  it('normalises line endings and passes everything else through', () => {
    expect(planPaste('one\r\ntwo\r', '')!.text).toBe('one\ntwo\n');
    expect(planPaste('', 'anything')).toBeNull();
  });
});

describe('markdownForSelection', () => {
  const raws = ['# Title', '- one\n- two', 'A closing paragraph.'];

  it('returns whole blocks for a selection that spans them', () => {
    expect(markdownForSelection(raws, { from: 0, to: 2 })).toBe(
      '# Title\n\n- one\n- two\n\nA closing paragraph.',
    );
  });

  it('cuts the two ends where the selection actually stopped', () => {
    expect(
      markdownForSelection(raws, {
        from: 0,
        to: 1,
        fromOffset: 2,
        toOffset: 5,
      }),
    ).toBe('Title\n\n- one');
  });

  it('slices inside one block', () => {
    expect(
      markdownForSelection(raws, {
        from: 2,
        to: 2,
        fromOffset: 2,
        toOffset: 9,
      }),
    ).toBe('closing');
  });

  it('survives offsets that point outside the block', () => {
    expect(
      markdownForSelection(raws, {
        from: 0,
        to: 0,
        fromOffset: -5,
        toOffset: 999,
      }),
    ).toBe('# Title');
    expect(markdownForSelection(raws, { from: 3, to: 9 })).toBe('');
  });
});
