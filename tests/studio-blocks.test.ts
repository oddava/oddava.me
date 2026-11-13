import { describe, expect, it } from 'vitest';
import {
  blockLabel,
  matchSlashCommands,
  parseBlocks,
} from '../src/components/admin/studioBlocks';
import { DEFAULT_SESSION } from '../src/components/admin/studioSession';

const NOTE = [
  '# A note',
  '',
  'A paragraph that runs',
  'across two lines.',
  '',
  '- one',
  '- two',
  '',
  '```js',
  'const x = 1;',
  '',
  'const y = 2;',
  '```',
  '',
  '> quoted',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
].join('\n');

describe('parseBlocks', () => {
  it('splits a note into typed blocks', () => {
    expect(parseBlocks(NOTE).map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'code',
      'quote',
      'table',
    ]);
  });

  it('gives every block a range that slices its own source back out', () => {
    const source = NOTE;
    for (const block of parseBlocks(source)) {
      expect(source.slice(block.start, block.end)).toBe(block.raw);
    }
  });

  it('keeps blank lines inside a fenced block', () => {
    const code = parseBlocks(NOTE).find((block) => block.type === 'code');
    expect(code?.raw).toBe('```js\nconst x = 1;\n\nconst y = 2;\n```');
  });

  it('records heading depth', () => {
    const blocks = parseBlocks('# one\n\n### three');
    expect(blocks.map((block) => block.depth)).toEqual([1, 3]);
  });

  it('holds a loose list together across a single blank line', () => {
    const blocks = parseBlocks('- one\n\n- two\n\nA paragraph.');
    expect(blocks.map((block) => block.type)).toEqual(['list', 'paragraph']);
    expect(blocks[0]?.raw).toBe('- one\n\n- two');
  });

  it('classifies a list with checkboxes as a task list', () => {
    expect(parseBlocks('- [ ] one\n- [x] two')[0]?.type).toBe('task');
  });

  // The toolbar's alignment wrapper and captioned figures both put blank lines
  // inside one HTML block. Splitting them would splice into the middle of a tag.
  it('keeps an HTML container whole across blank lines', () => {
    const html = '<div style="text-align:center">\n\ninner\n\n</div>';
    const blocks = parseBlocks(`before\n\n${html}\n\nafter`);
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'html',
      'paragraph',
    ]);
    expect(blocks[1]?.raw).toBe(html);
  });

  // An opening tag with no closer is what every keystroke of `<div` looks like
  // while it is still being typed, and what is left behind when a closing tag
  // is deleted. Running to the end of the file would swallow the whole note
  // into one block under the caret.
  it('stops an unclosed HTML container at the first blank line', () => {
    const blocks = parseBlocks(
      '<div style="text-align:center">\nstill typing\n\nafter\n\n## a heading',
    );
    expect(blocks.map((block) => block.type)).toEqual([
      'html',
      'paragraph',
      'heading',
    ]);
    expect(blocks[0]?.raw).toBe(
      '<div style="text-align:center">\nstill typing',
    );
  });

  it('recognises a figure as an image block', () => {
    const blocks = parseBlocks(
      '<figure class="note-figure">\n  <img src="/a.png" alt="a">\n</figure>',
    );
    expect(blocks[0]?.type).toBe('image');
  });

  it('treats a lone markdown image as an image block', () => {
    expect(parseBlocks('![alt](/a.png)')[0]?.type).toBe('image');
    expect(parseBlocks('text ![alt](/a.png)')[0]?.type).toBe('paragraph');
  });

  it('has no blocks in an empty note', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('matchSlashCommands', () => {
  it('matches on title and on keywords', () => {
    expect(matchSlashCommands('todo').map((item) => item.id)).toEqual(['task']);
    expect(matchSlashCommands('head').map((item) => item.id)).toEqual([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ]);
  });

  it('offers everything when nothing is typed', () => {
    expect(matchSlashCommands('').length).toBeGreaterThan(6);
  });

  it('keeps the rarer heading levels for a search', () => {
    const idle = matchSlashCommands('').map((item) => item.id);
    expect(idle).toEqual(expect.arrayContaining(['h1', 'h2', 'h3']));
    expect(idle).not.toEqual(expect.arrayContaining(['h4']));
    expect(matchSlashCommands('h5')[0]?.id).toBe('h5');
  });

  it('groups the full menu so its shape is learnable', () => {
    const groups = matchSlashCommands('').map((item) => item.group);
    // Each group appears once, as one run of rows.
    expect(new Set(groups).size).toBe(
      groups.filter((group, index) => group !== groups[index - 1]).length,
    );
  });

  it('puts the best answer first rather than the first match', () => {
    expect(matchSlashCommands('h1')[0]?.id).toBe('h1');
    expect(matchSlashCommands('code')[0]?.id).toBe('code');
    expect(matchSlashCommands('table')[0]?.id).toBe('table');
    // `list` names three of them; the one actually called a list wins.
    expect(matchSlashCommands('list')[0]?.id).toBe('bullet');
  });
});

describe('unified editor session', () => {
  it('does not persist an editing mode', () => {
    expect(DEFAULT_SESSION).not.toHaveProperty('view');
  });
});

describe('parseBlocks: callouts and footnotes', () => {
  it('names a callout apart from an ordinary quote', () => {
    const blocks = parseBlocks('> [!TIP]\n> Kind.\n\n> Just a quote.');
    expect(blocks.map((block) => block.type)).toEqual(['callout', 'quote']);
    expect(blockLabel(blocks[0]!)).toBe('Callout');
  });

  it('keeps a footnote definition whole across blank lines', () => {
    const source = 'Text[^1]\n\n[^1]: First.\n\n    Second.\n\nAfter.';
    const blocks = parseBlocks(source);
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'footnote',
      'paragraph',
    ]);
    expect(blocks[1]!.raw).toBe('[^1]: First.\n\n    Second.');
    expect(blockLabel(blocks[1]!)).toBe('Footnote');
  });

  it('ends a paragraph where a definition begins', () => {
    expect(
      parseBlocks('One line[^a]\n[^a]: Note.').map((block) => block.type),
    ).toEqual(['paragraph', 'footnote']);
  });

  it('does not take a link reference for a footnote', () => {
    expect(parseBlocks('[ref]: https://example.com')[0]?.type).toBe(
      'paragraph',
    );
  });
});

describe('slash menu: callouts and footnotes', () => {
  it('offers a callout by default and the other tones when searched for', () => {
    const idle = matchSlashCommands('').map((item) => item.id);
    expect(idle).toContain('callout');
    expect(idle.filter((id) => id.startsWith('callout-'))).toEqual([]);
    expect(matchSlashCommands('callout')[0]?.id).toBe('callout');
    expect(matchSlashCommands('callout').map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'callout-tip',
        'callout-important',
        'callout-warning',
        'callout-caution',
      ]),
    );
  });

  it('finds each callout by its own word', () => {
    expect(matchSlashCommands('warning')[0]?.id).toBe('callout-warning');
    expect(matchSlashCommands('tip')[0]?.id).toBe('callout-tip');
    expect(matchSlashCommands('admonition')[0]?.id).toBe('callout');
  });

  it('offers footnotes under Insert, with the shorthand it writes', () => {
    const footnote = matchSlashCommands('footnote')[0]!;
    expect(footnote).toMatchObject({
      id: 'footnote',
      group: 'Insert',
      hint: '[^1]',
    });
    expect(matchSlashCommands('').map((item) => item.id)).toContain('footnote');
  });

  it('teaches the markdown that makes each callout', () => {
    const hints = matchSlashCommands('callout').map((item) => item.hint);
    expect(hints).toContain('> [!NOTE]');
    expect(hints).toContain('> [!CAUTION]');
  });

  it('does not make "head" find a warning', () => {
    expect(matchSlashCommands('head').map((item) => item.id)).not.toContain(
      'callout-warning',
    );
  });
});
