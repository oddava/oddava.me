import { describe, expect, it } from 'vitest';
import {
  createHighlightBudget,
  highlightToHtml,
  MAX_DOCUMENT_HIGHLIGHT_LENGTH,
  tokenizeCode,
} from '../src/lib/garden/highlight';
import { GRAMMARS } from '../src/lib/garden/highlight-grammars';
import { renderNoteHtml } from '../src/lib/garden/render';

// The largest block the highlighter accepts.
const N = 30_000;

// Runs that a failing rule used to read across at every position. Before the
// fix the worst took ~3.5s for one block (html words, rust/go `$`, bash and
// yaml whitespace after a word); now each is a few milliseconds of linear work.
const ADVERSARIAL: Record<string, string> = {
  word: 'a'.repeat(N),
  spaces: ' '.repeat(N),
  tabs: '\t'.repeat(N),
  newlines: '\n'.repeat(N),
  wordThenSpaces: `a${' '.repeat(N - 1)}`,
  equalsThenSpaces: `=${' '.repeat(N - 1)}`,
  dashThenSpaces: `-${' '.repeat(N - 1)}`,
  brackets: '['.repeat(N),
  bracketWords: '[a'.repeat(N / 2),
  colons: 'a:'.repeat(N / 2),
  ats: '@'.repeat(N),
  dollars: '$'.repeat(N),
  quotes: '"'.repeat(N),
  backticks: '`'.repeat(N),
  hashes: '#'.repeat(N),
  angles: '<'.repeat(N),
};

describe('highlighting stays linear', () => {
  for (const language of Object.keys(GRAMMARS)) {
    it(`tokenizes worst-case ${language} quickly`, () => {
      for (const [name, code] of Object.entries(ADVERSARIAL)) {
        const start = performance.now();
        tokenizeCode(code, language);
        const ms = performance.now() - start;
        // Generous for a slow runner; the quadratic cases took 600–6,000ms.
        expect(ms, `${language} × ${name}`).toBeLessThan(400);
      }
    });
  }
});

describe('silent run rules change no tokens', () => {
  it('still finds html attributes, values and entities after long words', () => {
    const code = `<a ${'x'.repeat(50)} href="/x">&amp;</a>`;
    expect(
      tokenizeCode(code, 'html').map(({ from, to, kind }) => [
        code.slice(from, to),
        kind,
      ]),
    ).toEqual([
      ['<a', 'tag'],
      ['href', 'attr'],
      ['"/x"', 'str'],
      ['>', 'tag'],
      ['&amp;', 'lit'],
      ['</a', 'tag'],
      ['>', 'tag'],
    ]);
  });

  it('still finds a markdown link after brackets that are not links', () => {
    const code = '[[a] [b] see [docs](https://x.test) and - not a list';
    const kinds = tokenizeCode(code, 'md').map(({ from, to, kind }) => [
      code.slice(from, to),
      kind,
    ]);
    expect(kinds).toEqual([['[docs](https://x.test)', 'fn']]);
    expect(tokenizeCode('  - item', 'md')).toEqual([
      { from: 0, to: 3, kind: 'punct' },
    ]);
  });

  it('still finds indented decorators, directives and shell commands', () => {
    expect(tokenizeCode('    @cache', 'python')).toEqual([
      { from: 4, to: 10, kind: 'attr' },
    ]);
    expect(tokenizeCode('  #include', 'c')).toEqual([
      { from: 2, to: 10, kind: 'kw' },
    ]);
    expect(tokenizeCode('a |   grep x', 'bash')).toContainEqual({
      from: 6,
      to: 10,
      kind: 'fn',
    });
  });
});

describe('document highlighting budget', () => {
  it('renders blocks past the budget as plain escaped code', () => {
    const block = `const a = "<b>";\n${'x'.repeat(29_000)}`;
    const fence = `\`\`\`js\n${block}\n\`\`\`\n\n`;
    const count = Math.ceil(MAX_DOCUMENT_HIGHLIGHT_LENGTH / block.length) + 2;
    const html = renderNoteHtml(fence.repeat(count));

    const blocks = html.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
    expect(blocks).toHaveLength(count);
    const highlighted = blocks.filter((pre) => pre.includes('tok-kw'));
    expect(highlighted.length).toBe(
      Math.floor(MAX_DOCUMENT_HIGHLIGHT_LENGTH / block.length),
    );
    const plain = blocks.at(-1)!;
    expect(plain).not.toContain('<span');
    expect(plain).toContain('const a = "&lt;b&gt;";');
    // The language label stays, only the colour goes.
    expect(plain).toContain('data-language="JavaScript"');
  });

  it('starts every render with a fresh allowance', () => {
    const fence = `\`\`\`js\nconst a = 1;\n\`\`\``;
    renderNoteHtml(`\`\`\`js\n${'x'.repeat(N)}\n\`\`\`\n`.repeat(5));
    expect(renderNoteHtml(fence)).toContain('tok-kw');
  });

  it('spends a block only when it fits', () => {
    const budget = createHighlightBudget(10);
    expect(highlightToHtml('const a', 'js', budget)).toContain('tok-kw');
    expect(budget.remaining).toBe(3);
    expect(highlightToHtml('const b', 'js', budget)).toBe('const b');
    expect(budget.remaining).toBe(3);
  });
});
