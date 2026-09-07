import {
  moveBeside,
  moveBlockTo,
  removeBlock,
} from '../src/components/admin/studioSideDrop';
import {
  Columns,
  Column,
  makeColumns,
} from '../src/components/admin/studioColumns';
import { renderNote } from '../src/lib/garden/render';
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { RichImage as Image } from '../src/components/admin/studioRichImage';
import {
  RichDocument,
  SourceBlock,
  WikiLink,
} from '../src/components/admin/studioRichDocument';

const editors: Editor[] = [];
function open(body: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown,
      TaskList,
      TaskItem,
      TableKit,
      Image,
      Columns,
      Column,
      SourceBlock,
      WikiLink,
    ],
  });
  editors.push(editor);
  const document = new RichDocument();
  editor.commands.setContent(document.parse(editor, body), {
    emitUpdate: false,
  });
  editor.view.updateState(
    EditorState.create({
      doc: editor.state.doc,
      plugins: editor.state.plugins,
    }),
  );
  document.remember(editor, body);
  return { editor, document };
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('rich Markdown document boundary', () => {
  it('retains exact Markdown and separators in unedited siblings', () => {
    const body =
      '# Title\n\nFirst paragraph.\n\n\n* one\n* two\n\n<div style="text-align:center">\n\n**Keep this**\n\n</div>\n';
    const { editor, document } = open(body);
    expect(document.serialize(editor)).toBe(body);
    editor.commands.insertContentAt(3, 'new ');
    expect(document.serialize(editor)).toBe(
      body.replace('# Title', '# Tinew tle'),
    );
  });
  it('keeps editable wiki links intact when editing the containing paragraph', () => {
    const { editor, document } = open('See [[notes/example|Example]] today.');
    expect(editor.getJSON().content?.[0]?.content?.[1]?.type).toBe('wikiLink');
    editor.commands.insertContentAt(1, 'Also ');
    expect(document.serialize(editor)).toBe(
      'Also See [[notes/example|Example]] today.',
    );
  });
  it('preserves task state and table structure through edits', () => {
    const { editor, document } = open(
      '- [ ] One\n- [x] Two\n\n| A | B |\n| --- | --- |\n| C | D |',
    );
    expect(editor.getJSON().content?.[0]?.type).toBe('taskList');
    editor.commands.insertContentAt(3, 'New ');
    expect(document.serialize(editor)).toContain('- [ ] New One');
    expect(document.serialize(editor)).toContain('- [x] Two');
    expect(document.serialize(editor)).toContain(
      '| A | B |\n| --- | --- |\n| C | D |',
    );
  });
  it('keeps unsupported markup explicit and lossless', () => {
    const body =
      '<figure><img src="/image.png" width="300" /><figcaption><em>Caption</em></figcaption></figure>\n\n[ref]: https://example.com';
    const { editor, document } = open(body);
    expect(
      editor.getJSON().content?.every((node) => node.type === 'sourceBlock'),
    ).toBe(true);
    expect(document.serialize(editor)).toBe(body);
  });
  it('preserves reference links and footnotes outside the supported schema', () => {
    const body =
      'Read [this][ref] and the footnote[^1].\n\n[ref]: https://example.com\n\n[^1]: Details.';
    const { editor, document } = open(body);
    expect(
      editor.getJSON().content?.every((node) => node.type === 'sourceBlock'),
    ).toBe(true);
    expect(document.serialize(editor)).toBe(body);
  });
  it('undo restores the original Markdown after a block edit', () => {
    const body = '*one* and __two__\n\nUntouched.';
    const { editor, document } = open(body);
    editor.commands.insertContentAt(1, 'New ');
    expect(document.serialize(editor)).toContain('New ');
    editor.commands.undo();
    // Undo restores content, which may have a new immutable node identity.
    expect(document.serialize(editor)).toBe(body);
  });
});

describe('rich image markup', () => {
  it('renders legacy local figures without rewriting them until adjusted', () => {
    const body =
      '<figure style="text-align:center">\n<img src="/images/notes/example/photo.jpg" alt="Photo" style="width:50%">\n<figcaption style="opacity:.7">A caption</figcaption>\n</figure>';
    const { editor, document } = open(body);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'image',
      attrs: {
        src: '/images/notes/example/photo.jpg',
        caption: 'A caption',
        align: 'center',
        widthPercent: 50,
      },
    });
    expect(document.serialize(editor)).toBe(body);
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { caption: 'Changed caption' });
    expect(document.serialize(editor)).toContain('note-image--width-50');
    expect(document.serialize(editor)).toContain('Changed caption');
    editor.commands.undo();
    expect(document.serialize(editor)).toBe(body);
  });
  it('keeps unsupported image URL schemes in source instead of mounting them', () => {
    const { editor } = open('<img src="javascript:alert(1)">');
    expect(editor.getJSON().content?.[0]?.type).toBe('sourceBlock');
  });
});

describe('columns', () => {
  it('edits mixed column content and preserves it through serialization and undo', () => {
    const body =
      ':::columns left\n## Heading\n\n![Photo](/photo.png)\n:::column\n- [ ] Task\n\nSee [[notes/example|Example]].\n:::';
    const { editor, document } = open(body);
    expect(editor.state.doc.firstChild?.type.name).toBe('columns');
    editor.commands.insertContentAt(3, 'New ');
    const saved = document.serialize(editor);
    const reopened = open(saved);
    expect(reopened.editor.getJSON()).toEqual(editor.getJSON());
    const rendered = renderNote(saved, {
      wikiLinkHrefs: new Map([['notes/example', '/notes/example']]),
    });
    expect(rendered.html).toContain('note-columns--left');
    expect(rendered.html).toContain('src="/photo.png"');
    expect(rendered.html).toContain('href="/notes/example"');
    expect(rendered.headings[0]?.text).toBe('New Heading');
    editor.commands.undo();
    expect(document.serialize(editor)).toBe(body);
  });
  it('converts existing blocks without duplicating content', () => {
    const { editor, document } = open('![Photo](/photo.png)\n\nAfter.');
    makeColumns(editor, 0);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(document.serialize(editor).match(/Photo/g)).toHaveLength(1);
    expect(open(document.serialize(editor)).editor.getJSON()).toEqual(
      editor.getJSON(),
    );
  });
  it('ignores column separators in fenced code and supports nested rows', () => {
    const body =
      ':::columns equal\n```text\n:::column\n:::\n```\n:::column\n:::columns equal\nOne\n:::column\nTwo\n:::\n:::';
    const { editor, document } = open(body);
    expect(editor.state.doc.childCount).toBe(1);
    expect(document.serialize(editor)).toBe(body);
    expect(renderNote(body).html.match(/class="note-columns /g)).toHaveLength(
      2,
    );
  });
  it('retains image attributes when native dragging parses its HTML slice', () => {
    const { editor } = open(
      '<img src="/photo.png" alt="Photo" class="note-image note-image--width-50 note-image--align-right">',
    );
    const html = editor.getHTML();
    editor.commands.setContent(html);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      widthPercent: 50,
      align: 'right',
      src: '/photo.png',
    });
  });
});

describe('drag beside a block', () => {
  it.each(['left', 'right'] as const)(
    'moves an image to the %s without copying, with one-step undo',
    (side) => {
      const body =
        'Before.\n\n<img src="/photo.png" alt="Photo" class="note-image note-image--width-50">\n\nAfter.';
      const { editor, document } = open(body);
      const from = editor.state.doc.firstChild!.nodeSize;
      expect(moveBeside(editor, from, 0, side)).toBe(true);
      editor.state.doc.check();
      expect(editor.state.doc.firstChild?.type.name).toBe('columns');
      expect(document.serialize(editor).match(/photo.png/g)).toHaveLength(1);
      expect(open(document.serialize(editor)).editor.getJSON()).toEqual(
        editor.getJSON(),
      );
      editor.commands.undo();
      expect(document.serialize(editor)).toBe(body);
    },
  );
  it('adds a third column instead of nesting another row', () => {
    const { editor } = open(
      ':::columns equal\nLeft\n:::column\nRight\n:::\n\nThird',
    );
    const from = editor.state.doc.firstChild!.nodeSize;
    expect(moveBeside(editor, from, 1, 'left')).toBe(true);
    editor.state.doc.check();
    const row = editor.state.doc.firstChild!;
    expect(row.childCount).toBe(3);
    expect(row.firstChild!.textContent).toBe('Third');
    expect(row.attrs.layout).toBe('three');
  });
  it('removes the vacated column and unwraps the remaining content', () => {
    const { editor } = open(
      ':::columns equal\nLeft\n:::column\nRight\n:::\n\nTarget',
    );
    const target = editor.state.doc.firstChild!.nodeSize;
    expect(moveBeside(editor, 2, target, 'right')).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild!.textContent).toBe('Right');
    expect(editor.state.doc.lastChild!.textContent).toBe('TargetLeft');
  });
  it('moves across a row without leaving an empty column behind', () => {
    const { editor } = open(':::columns equal\nLeft\n:::column\nRight\n:::');
    const right = 1 + editor.state.doc.firstChild!.firstChild!.nodeSize;
    expect(moveBeside(editor, 2, right, 'right')).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.textContent).toBe('RightLeft');
  });
  it('does not allow drops into the source or a full row', () => {
    const { editor, document } = open(
      ':::columns three\nOne\n:::column\nTwo\n:::column\nThree\n:::\n\nFour',
    );
    const before = document.serialize(editor);
    expect(moveBeside(editor, 2, 1, 'right')).toBe(false);
    expect(
      moveBeside(editor, editor.state.doc.firstChild!.nodeSize, 1, 'left'),
    ).toBe(false);
    expect(document.serialize(editor)).toBe(before);
  });
});

describe('layout move transitions', () => {
  it('moving out of a row drops blank caret paragraphs and collapses the row', () => {
    const { editor, document } = open(
      ':::columns equal\n![A](/a.png)\n:::column\n![B](/b.png)\n:::',
    );
    // Writing below an image leaves a legitimate empty caret block behind.
    editor.commands.insertContentAt(3, { type: 'paragraph' });
    const before = document.serialize(editor);
    expect(moveBlockTo(editor, 2, editor.state.doc.content.size)).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.attrs.src).toBe('/b.png');
    expect(editor.state.doc.lastChild!.attrs.src).toBe('/a.png');
    editor.commands.undo();
    expect(document.serialize(editor)).toBe(before);
  });
  it('reorders a full row without inserting a fourth column', () => {
    const { editor } = open(
      ':::columns three\n![A](/a.png)\n:::column\n![B](/b.png)\n:::column\n![C](/c.png)\n:::',
    );
    const row = editor.state.doc.firstChild!;
    const third = 1 + row.child(0).nodeSize + row.child(1).nodeSize;
    expect(moveBeside(editor, 2, third, 'right')).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    expect(editor.state.doc.firstChild!.lastChild!.firstChild!.attrs.src).toBe(
      '/a.png',
    );
  });
  it('does not create a third column for two images and a blank caret', () => {
    const { editor } = open(
      ':::columns equal\n![A](/a.png)\n:::column\n![B](/b.png)\n:::',
    );
    editor.commands.insertContentAt(3, { type: 'paragraph' });
    const second = 1 + editor.state.doc.firstChild!.firstChild!.nodeSize;
    expect(moveBeside(editor, 2, second, 'right')).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.attrs.layout).toBe('equal');
  });
  it('uses an existing empty slot rather than adding another column', () => {
    const { editor } = open(
      ':::columns equal\n![A](/a.png)\n:::column\n\n:::\n\n![B](/b.png)',
    );
    const row = editor.state.doc.firstChild!;
    expect(
      moveBeside(editor, row.nodeSize, 1 + row.firstChild!.nodeSize, 'right'),
    ).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.attrs.layout).toBe('equal');
  });
  it('moving down from three columns leaves two, preserves unrelated empty layouts', () => {
    const { editor } = open(
      ':::columns three\n![A](/a.png)\n:::column\n![B](/b.png)\n:::column\n![C](/c.png)\n:::\n\n:::columns equal\nDraft\n:::column\n\n:::',
    );
    const firstSize = editor.state.doc.firstChild!.nodeSize;
    expect(moveBlockTo(editor, 2, firstSize)).toBe(true);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.attrs.layout).toBe('equal');
    expect(editor.state.doc.child(1).attrs.src).toBe('/a.png');
    expect(editor.state.doc.lastChild!.childCount).toBe(2);
  });
});

describe('empty layout repair', () => {
  it('opens and renders a saved empty third column as two columns', () => {
    const body =
      ':::columns three\n![A](/a.png)\n:::column\n![B](/b.png)\n:::column\n\n:::';
    const { editor } = open(body);
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.attrs.layout).toBe('equal');
    expect(renderNote(body).html.match(/class="note-column"/g)).toHaveLength(2);
    expect(renderNote(body).html).not.toContain('note-columns--three');
  });
  it('deleting a column’s last block unwraps its sibling, and undo restores it', () => {
    const body = ':::columns equal\n![A](/a.png)\n:::column\n![B](/b.png)\n:::';
    const { editor, document } = open(body);
    removeBlock(editor, 2);
    editor.state.doc.check();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.attrs.src).toBe('/b.png');
    editor.commands.undo();
    expect(document.serialize(editor)).toBe(body);
  });
});
