import { describe, expect, it } from 'vitest';
import {
  matchSlashCommands,
  parseBlocks,
} from '../src/components/admin/studioBlocks';
import {
  DEFAULT_SESSION,
  normalizeView,
} from '../src/components/admin/studioSession';

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
    ]);
  });

  it('offers everything when nothing is typed', () => {
    expect(matchSlashCommands('').length).toBeGreaterThan(6);
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

describe('normalizeView', () => {
  it('defaults to the visual editor', () => {
    expect(DEFAULT_SESSION.view).toBe('visual');
    expect(normalizeView(undefined)).toBe('visual');
    expect(normalizeView('nonsense')).toBe('visual');
  });

  // Sessions stored before the redesign name modes that no longer exist.
  it('migrates the retired write and split modes onto Visual', () => {
    expect(normalizeView('write')).toBe('visual');
    expect(normalizeView('split')).toBe('visual');
  });

  it('keeps the modes that survived', () => {
    expect(normalizeView('markdown')).toBe('markdown');
    expect(normalizeView('preview')).toBe('preview');
  });
});
