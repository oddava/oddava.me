import { describe, expect, it } from 'vitest';
import {
  activeBlockSpan,
  blockAtOffset,
  continueBlockOnEnter,
  deleteBlock,
  enableTaskCheckboxes,
  findSlashToken,
  formatTableBlock,
  indentLines,
  matchSlashCommands,
  moveBlock,
  parseBlocks,
  renumberOrderedList,
  reorderBlocks,
  sourceOffsetForText,
  spliceRange,
  splitBlockAt,
  toggleTaskInBlock,
  turnBlockInto,
  wrapSelection,
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

describe('spliceRange', () => {
  it('rewrites only the range it is given', () => {
    const blocks = parseBlocks(NOTE);
    const quote = blocks.find((block) => block.type === 'quote')!;
    const next = spliceRange(NOTE, quote.start, quote.end, '> louder');
    expect(next).toContain('> louder');
    // Everything else is byte-identical, fences and tables included.
    expect(next.replace('> louder', '> quoted')).toBe(NOTE);
  });
});

// What sits in an open block is source, and source re-parses as it is typed.
// The editor stands in for every block its range covers; any it does not take
// out of the rendered column shows up underneath, mirroring the keystrokes.
describe('activeBlockSpan', () => {
  it('covers every block a range re-parsed into, not just the first', () => {
    const doc = 'a paragraph\n- and a list';
    const blocks = parseBlocks(doc);
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list']);
    expect(activeBlockSpan(blocks, { start: 0, end: doc.length })).toEqual({
      first: 0,
      last: 1,
    });
  });

  it('is one block when the range is one block', () => {
    const blocks = parseBlocks('one\n\ntwo\n\nthree');
    expect(activeBlockSpan(blocks, { start: 5, end: 8 })).toEqual({
      first: 1,
      last: 1,
    });
  });

  it('is none for a slot opened between blocks', () => {
    // The blank run between two blocks belongs to neither of them.
    const blocks = parseBlocks('one\n\n\n\ntwo');
    expect(activeBlockSpan(blocks, { start: 5, end: 5 })).toBeNull();
  });

  it('is none without a range at all', () => {
    expect(activeBlockSpan(parseBlocks('one'), null)).toBeNull();
  });
});

describe('blockAtOffset', () => {
  it('finds the block a caret sits in', () => {
    const blocks = parseBlocks(NOTE);
    expect(blockAtOffset(blocks, 2)?.type).toBe('heading');
    expect(blockAtOffset(blocks, NOTE.length)?.type).toBe('table');
  });
});

describe('sourceOffsetForText', () => {
  it('maps a rendered offset back past inline markup', () => {
    const raw = 'a **bold** word';
    // The rendered text is "a bold word"; the caret before "word".
    expect(sourceOffsetForText(raw, 'a bold word', 7)).toBe(11);
  });

  it('maps through a link to its label', () => {
    const raw = 'see [the docs](https://example.com) now';
    // Offset 8 of "see the docs now" is the `d`; in the source that is the `d`
    // inside the link label, past the opening bracket.
    expect(raw.slice(sourceOffsetForText(raw, 'see the docs now', 8))).toBe(
      'docs](https://example.com) now',
    );
  });

  it('never runs past the end of the source', () => {
    expect(sourceOffsetForText('short', 'much longer text', 99)).toBe(5);
  });
});

describe('toggleTaskInBlock', () => {
  const raw = '- [ ] one\n- [x] two\n- [ ] three';

  it('ticks the box it is pointed at and leaves the rest', () => {
    expect(toggleTaskInBlock(raw, 0)).toBe('- [x] one\n- [x] two\n- [ ] three');
    expect(toggleTaskInBlock(raw, 1)).toBe('- [ ] one\n- [ ] two\n- [ ] three');
  });

  it('ignores an index with no checkbox behind it', () => {
    expect(toggleTaskInBlock(raw, 9)).toBe(raw);
  });
});

describe('enableTaskCheckboxes', () => {
  it('un-disables rendered checkboxes and numbers them', () => {
    const html =
      '<ul><li><input checked="" disabled="" type="checkbox"> a</li>' +
      '<li><input disabled="" type="checkbox"> b</li></ul>';
    const result = enableTaskCheckboxes(html);
    expect(result).not.toContain('disabled');
    expect(result).toContain('data-task="0"');
    expect(result).toContain('data-task="1"');
  });

  it('leaves other inputs alone', () => {
    const html = '<input type="text" disabled="">';
    expect(enableTaskCheckboxes(html)).toBe(html);
  });
});

describe('continueBlockOnEnter', () => {
  it('carries a bullet down to the next line', () => {
    const edit = continueBlockOnEnter('- one', 5);
    expect(edit).toEqual({ from: 5, to: 5, insert: '\n- ' });
  });

  it('counts an ordered list up', () => {
    expect(continueBlockOnEnter('1. one\n2. two', 13)?.insert).toBe('\n3. ');
  });

  it('carries a checkbox down unticked', () => {
    expect(continueBlockOnEnter('- [x] done', 10)?.insert).toBe('\n- [ ] ');
  });

  it('ends the list when the item is empty', () => {
    expect(continueBlockOnEnter('- one\n- ', 8)).toEqual({
      from: 6,
      to: 8,
      insert: '',
      caret: 6,
    });
  });

  it('steps a nested empty item out one level instead of ending the list', () => {
    const edit = continueBlockOnEnter('- one\n  - ', 10);
    expect(edit).toEqual({ from: 6, to: 10, insert: '- ', caret: 8 });
  });

  it('continues a quote', () => {
    expect(continueBlockOnEnter('> said', 6)?.insert).toBe('\n> ');
  });

  it('leaves ordinary text to the browser', () => {
    expect(continueBlockOnEnter('just words', 10)).toBeNull();
  });
});

describe('indentLines', () => {
  it('indents and outdents the lines under the selection', () => {
    const value = '- one\n- two';
    const indented = indentLines(value, 0, value.length, 1);
    expect(indented.insert).toBe('  - one\n  - two');
    expect(
      indentLines(indented.insert, 0, indented.insert.length, -1).insert,
    ).toBe(value);
  });
});

describe('renumberOrderedList', () => {
  it('renumbers each level independently', () => {
    expect(renumberOrderedList('1. a\n1. b\n  5. x\n  9. y\n1. c')).toBe(
      '1. a\n2. b\n  1. x\n  2. y\n3. c',
    );
  });
});

describe('splitBlockAt', () => {
  const doc = 'first\n\none two\n\nlast';
  const range = { start: 7, end: 14 };

  it('leaves the half above behind and returns the half below', () => {
    const result = splitBlockAt(doc, range, 3);
    expect(result.doc).toBe('first\n\none\n\ntwo\n\nlast');
    expect(result.doc.slice(result.range.start, result.range.end)).toBe('two');
  });

  it('starts an empty block when the caret was at the end', () => {
    const result = splitBlockAt(doc, range, 7);
    expect(result.doc).toBe('first\n\none two\n\n\n\nlast');
    expect(result.range.start).toBe(result.range.end);
  });

  it('does not carry the space at the split into the new block', () => {
    const result = splitBlockAt(doc, range, 4);
    expect(result.doc.slice(result.range.start, result.range.end)).toBe('two');
  });
});

describe('turnBlockInto', () => {
  it('swaps one marker for another rather than stacking them', () => {
    expect(turnBlockInto('- [ ] a task', { type: 'quote' })).toBe('> a task');
    expect(turnBlockInto('## heading', { type: 'list' })).toBe('- heading');
    expect(turnBlockInto('- item', { type: 'heading', depth: 2 })).toBe(
      '## item',
    );
  });

  it('strips back to plain text', () => {
    expect(turnBlockInto('### one\n', { type: 'paragraph' })).toBe('one\n');
    expect(turnBlockInto('> quoted', { type: 'paragraph' })).toBe('quoted');
  });

  it('wraps and unwraps a code fence', () => {
    expect(turnBlockInto('x = 1', { type: 'code' })).toBe('```\nx = 1\n```');
    expect(turnBlockInto('```js\nx = 1\n```', { type: 'paragraph' })).toBe(
      'x = 1',
    );
  });

  it('marks only the first line as a heading', () => {
    expect(turnBlockInto('one\ntwo', { type: 'heading', depth: 1 })).toBe(
      '# one\ntwo',
    );
  });

  // A rule has no content to carry over, and it is one line however many the
  // block had. Mapping it per line left a stack of them.
  it('makes one divider out of a block of any height', () => {
    expect(turnBlockInto('one\ntwo\nthree', { type: 'divider' })).toBe('---');
    expect(
      parseBlocks(turnBlockInto('one\ntwo', { type: 'divider' })),
    ).toHaveLength(1);
  });
});

describe('moveBlock', () => {
  it('trades a block with its neighbour and reports where it landed', () => {
    const doc = 'first\n\nsecond\n\nthird';
    const result = moveBlock(doc, parseBlocks(doc), 0, 1)!;
    expect(result.doc).toBe('second\n\nfirst\n\nthird');
    expect(result.doc.slice(result.range.start, result.range.end)).toBe(
      'first',
    );
  });

  it('refuses to move past either end', () => {
    const doc = 'only';
    expect(moveBlock(doc, parseBlocks(doc), 0, -1)).toBeNull();
    expect(moveBlock(doc, parseBlocks(doc), 0, 1)).toBeNull();
  });
});

describe('reorderBlocks', () => {
  const doc = 'a\n\nb\n\nc';

  it('drops a block in front of another', () => {
    const result = reorderBlocks(doc, parseBlocks(doc), 2, 0)!;
    expect(result.doc).toBe('c\n\na\n\nb');
    expect(result.doc.slice(result.range.start, result.range.end)).toBe('c');
  });

  it('drops a block at the end', () => {
    const result = reorderBlocks(doc, parseBlocks(doc), 0, 3)!;
    expect(result.doc).toBe('b\n\nc\n\na');
    expect(result.doc.slice(result.range.start, result.range.end)).toBe('a');
  });

  it('does nothing when the block would land where it already is', () => {
    expect(reorderBlocks(doc, parseBlocks(doc), 1, 1)).toBeNull();
    expect(reorderBlocks(doc, parseBlocks(doc), 1, 2)).toBeNull();
  });
});

describe('deleteBlock', () => {
  it('takes the separator with it', () => {
    const doc = 'a\n\nb\n\nc';
    expect(deleteBlock(doc, parseBlocks(doc), 1)?.doc).toBe('a\n\nc');
    expect(deleteBlock(doc, parseBlocks(doc), 2)?.doc).toBe('a\n\nb');
  });
});

describe('findSlashToken', () => {
  it('opens on a slash that starts a line', () => {
    expect(findSlashToken('/head', 5)).toEqual({
      start: 0,
      end: 5,
      query: 'head',
    });
  });

  it('opens inside a list item, where a new block is just as likely', () => {
    expect(findSlashToken('- /qu', 5)?.start).toBe(2);
  });

  it('stays shut for a slash in prose', () => {
    expect(findSlashToken('and/or', 6)).toBeNull();
    expect(findSlashToken('a /b', 4)).toBeNull();
    expect(findSlashToken('/two words', 10)).toBeNull();
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

describe('wrapSelection', () => {
  it('wraps the selection and keeps it, so a second press means bold', () => {
    const once = wrapSelection('say hello there', 4, 9, '*')!;
    expect(once.insert).toBe('*hello*');
    const applied = spliceRange(
      'say hello there',
      once.from,
      once.to,
      once.insert,
    );
    expect(applied).toBe('say *hello* there');
    // The caret range comes back around the same word, one marker in.
    expect(applied.slice(once.caret, once.caretEnd)).toBe('hello');
  });

  it('knows the pairs that are not the same character both ends', () => {
    expect(wrapSelection('a link', 2, 6, '[')!.insert).toBe('[link]');
    expect(wrapSelection('a link', 2, 6, '(')!.insert).toBe('(link)');
  });

  it('leaves an ordinary keystroke to the browser', () => {
    expect(wrapSelection('hello', 0, 5, 'x')).toBeNull();
    // Nothing selected: `*` is just an asterisk.
    expect(wrapSelection('hello', 2, 2, '*')).toBeNull();
    // Across a blank line the markers could not pair up.
    expect(wrapSelection('one\n\ntwo', 0, 8, '*')).toBeNull();
  });
});

describe('formatTableBlock', () => {
  it('lines the pipes up', () => {
    const messy = ['|a|Column B|', '|-|:-:|', '|1|two|'].join('\n');
    expect(formatTableBlock(messy)).toBe(
      ['| a   | Column B |', '| --- | :------: |', '| 1   | two      |'].join(
        '\n',
      ),
    );
  });

  it('keeps each column’s alignment', () => {
    const source = [
      '| a | b | c |',
      '| :-- | :-: | --: |',
      '| 1 | 2 | 3 |',
    ].join('\n');
    // Each marker grows to its column's width; the colons that carry the
    // meaning stay on the ends they were written on.
    expect(formatTableBlock(source).split('\n')[1]).toBe(
      '| :--- | :---: | ---: |',
    );
  });

  it('is stable: formatting an aligned table changes nothing', () => {
    const once = formatTableBlock('| a | bb |\n| --- | --- |\n| 1 | 2 |');
    expect(formatTableBlock(once)).toBe(once);
  });

  it('pads a short row out rather than losing the column', () => {
    const ragged = ['| a | b |', '| --- | --- |', '| 1 |'].join('\n');
    expect(formatTableBlock(ragged).split('\n')[2]).toBe('| 1   |     |');
  });

  it('measures a cell in characters, not in code units', () => {
    const widths = formatTableBlock('| 🌱 | b |\n| --- | --- |\n| xx | y |')
      .split('\n')
      // Counted the way the formatter counts: an emoji is one character, not
      // the two UTF-16 units it is stored as.
      .map((row) => [...row].length);
    expect(new Set(widths).size).toBe(1);
  });

  it('leaves anything that is not a table alone', () => {
    expect(formatTableBlock('just | a sentence')).toBe('just | a sentence');
    expect(formatTableBlock('# heading')).toBe('# heading');
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
