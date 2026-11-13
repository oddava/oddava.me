import {
  BlockSelection,
  BlockSelectionExtension,
  duplicateSelectedBlocks,
} from '../src/components/admin/studioBlockSelection';
import {
  moveBeside,
  moveBlockTo,
  moveBlocksTo,
  removeBlock,
} from '../src/components/admin/studioSideDrop';
import {
  Columns,
  Column,
  makeColumns,
} from '../src/components/admin/studioColumns';
import { renderNote } from '../src/lib/garden/render';
import { YoutubeVideo } from '../src/components/admin/studioYoutube';
import { youtubeMarkup } from '../src/lib/garden/youtube';
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
import { studioBlockExtensions } from '../src/components/admin/studioBlockExtensions';
import { insertFootnote } from '../src/components/admin/studioBlockCommands';
import {
  footnoteIds,
  jumpToDefinition,
  jumpToReference,
} from '../src/components/admin/studioFootnotes';

const editors: Editor[] = [];
function open(body: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false, codeBlock: false }),
      Markdown,
      TaskList,
      TaskItem,
      TableKit,
      Image,
      YoutubeVideo,
      Columns,
      BlockSelectionExtension,
      Column,
      SourceBlock,
      WikiLink,
      ...studioBlockExtensions,
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

/** Type `text` at the caret the way the browser would: through input rules. */
function typeText(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  editor.view.someProp('handleTextInput', (handle) =>
    handle(editor.view, from, to, text, () => editor.state.tr),
  );
}

describe('rich Markdown document boundary', () => {
  it('preserves YouTube blocks through edits and Markdown reloads', () => {
    const markup = youtubeMarkup('https://youtu.be/dQw4w9WgXc?t=90');
    const { editor, document } = open(markup);
    expect(editor.state.doc.firstChild?.type.name).toBe('youtubeVideo');
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'After the video' }],
    });
    const saved = document.serialize(editor);
    const reloaded = open(saved);
    expect(reloaded.editor.state.doc.firstChild?.attrs.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXc?start=90',
    );
    expect(saved).toContain(markup);
    expect(saved).toContain('After the video');
  });
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
  it('keeps reference links as source while footnotes become real nodes', () => {
    const body =
      'Read [this][ref] and the footnote[^1].\n\n[ref]: https://example.com\n\n[^1]: Details.';
    const { editor, document } = open(body);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'sourceBlock',
      'sourceBlock',
      'footnoteDefinition',
    ]);
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

describe('block selection', () => {
  it('copies only selected blocks and deletes disjoint ranges without losing siblings', () => {
    const body = 'One\n\nTwo\n\nThree';
    const { editor, document } = open(body);
    const third =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    const selection = new BlockSelection(editor.state.doc, [0, third]);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    expect(
      selection
        .content()
        .content.textBetween(0, selection.content().content.size, '|'),
    ).toBe('One|Three');
    editor.view.dispatch(editor.state.tr.deleteSelection());
    expect(editor.state.doc.textContent).toBe('Two');
    editor.commands.undo();
    expect(document.serialize(editor)).toBe(body);
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
  });
  it('cutting across columns unwraps the remaining blocks', () => {
    const { editor } = open(
      ':::columns equal\nAlpha\n\nKeep\n:::column\nBeta\n:::',
    );
    const beta = editor.state.doc.firstChild!.firstChild!.nodeSize + 2;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new BlockSelection(editor.state.doc, [2, beta]),
      ),
    );
    editor.view.dispatch(editor.state.tr.deleteSelection());
    editor.state.doc.check();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(editor.state.doc.textContent).toBe('Keep');
  });
  it('moves a selected group without copying or reversing its blocks', () => {
    const { editor } = open('One\n\nTwo\n\nThree');
    const positions = [0, editor.state.doc.firstChild!.nodeSize];
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new BlockSelection(editor.state.doc, positions),
      ),
    );
    moveBlocksTo(editor, positions, editor.state.doc.content.size);
    editor.state.doc.check();
    expect(editor.state.doc.textContent).toBe('ThreeOneTwo');
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe('OneTwoThree');
  });
  it('snaps a group as one column and preserves its order', () => {
    const { editor } = open('One\n\nTwo\n\nThree');
    const positions = [0, editor.state.doc.firstChild!.nodeSize];
    const third = positions[1]! + editor.state.doc.child(1).nodeSize;
    moveBeside(editor, 0, third, 'right', positions);
    editor.state.doc.check();
    expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe('Three');
    expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe('OneTwo');
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
  });
});

describe('selected block editing', () => {
  it('duplicates all selected blocks in place and selects the copies', () => {
    const { editor } = open('One\n\nTwo\n\nThree');
    const positions = [0, editor.state.doc.firstChild!.nodeSize];
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new BlockSelection(editor.state.doc, positions),
      ),
    );
    duplicateSelectedBlocks(editor);
    editor.state.doc.check();
    expect(editor.state.doc.textContent).toBe('OneOneTwoTwoThree');
    expect((editor.state.selection as BlockSelection).positions).toHaveLength(
      2,
    );
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe('OneTwoThree');
  });
  it('replacing disjoint selected blocks keeps the unselected content', () => {
    const { editor } = open('One\n\nKeep\n\nThree');
    const third =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new BlockSelection(editor.state.doc, [0, third]),
      ),
    );
    editor.view.dispatch(editor.state.tr.insertText('New'));
    editor.state.doc.check();
    expect(editor.state.doc.textContent).toBe('NewKeep');
  });
});

describe('code blocks with a language', () => {
  const body = '```ts\nconst a = 1; // one\n```';
  it('persists the language as the fence and survives a reload', () => {
    const { editor, document } = open(`Before.\n\n${body}\n\nAfter.`);
    const block = editor.getJSON().content?.[1];
    expect(block).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'ts' },
    });
    expect(document.serialize(editor)).toBe(`Before.\n\n${body}\n\nAfter.`);
    editor.commands.insertContentAt(3, 'New ');
    const saved = document.serialize(editor);
    expect(open(saved).editor.getJSON()).toEqual(editor.getJSON());
  });

  it('writes a changed language back, and none for plain text', () => {
    const { editor, document } = open(body);
    editor.commands.updateAttributes('codeBlock', { language: 'python' });
    expect(document.serialize(editor)).toBe(
      '```python\nconst a = 1; // one\n```',
    );
    editor.commands.updateAttributes('codeBlock', { language: null });
    expect(document.serialize(editor)).toBe('```\nconst a = 1; // one\n```');
  });

  it('paints token classes and a chip naming the language', () => {
    const { editor } = open(body);
    const dom = editor.view.dom;
    expect(
      [...dom.querySelectorAll('.tok-kw')].map((el) => el.textContent),
    ).toEqual(['const']);
    expect(dom.querySelector('.tok-com')?.textContent).toBe('// one');
    expect(dom.querySelector('pre')?.getAttribute('data-language')).toBe(
      'TypeScript',
    );
    const chip = dom.querySelector<HTMLButtonElement>('.studio-code-lang')!;
    expect(chip.textContent).toBe('TypeScript');
    expect(chip.getAttribute('aria-haspopup')).toBe('listbox');
    // Colour is a class, never an inline style the CSP would refuse.
    expect(dom.querySelector('pre [style]')).toBeNull();
  });

  it('re-colours when the language changes and when the code does', () => {
    const { editor } = open('```\nconst a = 1\n```');
    expect(editor.view.dom.querySelector('.tok-kw')).toBeNull();
    editor.commands.updateAttributes('codeBlock', { language: 'js' });
    expect(editor.view.dom.querySelector('.tok-kw')?.textContent).toBe('const');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' let');
    expect(editor.view.dom.querySelectorAll('.tok-kw')).toHaveLength(2);
  });

  it('keeps a language it does not know and labels the chip with it', () => {
    const { editor, document } = open('```haskell\nmain = pure ()\n```');
    expect(
      editor.view.dom.querySelector('.studio-code-lang')?.textContent,
    ).toBe('haskell');
    expect(editor.view.dom.querySelector('[class*="tok-"]')).toBeNull();
    expect(document.serialize(editor)).toBe('```haskell\nmain = pure ()\n```');
  });
});

describe('callouts', () => {
  it('is a real node whose body is ordinary blocks', () => {
    const body = '> [!WARNING]\n> Mind **the** gap.\n>\n> - one\n> - two';
    const { editor, document } = open(body);
    const callout = editor.getJSON().content?.[0];
    expect(callout).toMatchObject({
      type: 'callout',
      attrs: { kind: 'warning' },
    });
    expect(callout?.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'bulletList',
    ]);
    expect(document.serialize(editor)).toBe(body);
  });

  it('round-trips every kind, an empty one and a multi-block body', () => {
    for (const body of [
      '> [!NOTE]\n> Plain.',
      '> [!TIP]\n> Plain.',
      '> [!IMPORTANT]\n> Plain.',
      '> [!WARNING]\n> Plain.',
      '> [!CAUTION]\n> Plain.',
      '> [!NOTE]',
      '> [!TIP]\n> One.\n>\n> Two.\n>\n> ```js\n> let a = 1;\n> ```',
    ]) {
      const { editor, document } = open(body);
      expect(editor.state.doc.firstChild?.type.name).toBe('callout');
      expect(document.serialize(editor)).toBe(body);
      // The editor's own serializer agrees, so an edited callout is not lossy.
      const rewritten = editor.markdown!.serialize({
        type: 'doc',
        content: [editor.state.doc.firstChild!.toJSON()],
      });
      expect(open(rewritten).editor.getJSON()).toEqual(editor.getJSON());
    }
  });

  it('edits in place and changes kind', () => {
    const { editor, document } = open('> [!NOTE]\n> Hello.\n\nAfter.');
    editor.commands.insertContentAt(2, 'Oh, ');
    expect(document.serialize(editor)).toBe(
      '> [!NOTE]\n> Oh, Hello.\n\nAfter.',
    );
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('callout', { kind: 'tip' });
    expect(document.serialize(editor)).toBe('> [!TIP]\n> Oh, Hello.\n\nAfter.');
    editor.commands.undo();
    editor.commands.undo();
    expect(document.serialize(editor)).toBe('> [!NOTE]\n> Hello.\n\nAfter.');
  });

  it('draws the same card the page does, with a working kind button', () => {
    const { editor } = open('> [!TIP]\n> Be kind.');
    const card = editor.view.dom.querySelector('.callout')!;
    expect(card.className).toBe('callout callout--tip');
    expect(card.getAttribute('role')).toBe('note');
    expect(card.querySelector('svg.callout__icon')).not.toBeNull();
    const button = card.querySelector<HTMLButtonElement>('.callout__kind')!;
    expect(button.textContent).toBe('Tip');
    expect(button.getAttribute('aria-label')).toBe(
      'Callout kind: Tip. Change kind',
    );
    editor.commands.updateAttributes('callout', { kind: 'caution' });
    expect(editor.view.dom.querySelector('.callout--caution')).not.toBeNull();
    expect(editor.view.dom.querySelectorAll('svg.callout__icon')).toHaveLength(
      1,
    );
  });

  it('wraps the current block with setCallout and retargets an existing one', () => {
    const { editor, document } = open('Wrap me.');
    editor.commands.setCallout('important');
    expect(document.serialize(editor)).toBe('> [!IMPORTANT]\n> Wrap me.');
    editor.commands.setCallout('warning');
    expect(document.serialize(editor)).toBe('> [!WARNING]\n> Wrap me.');
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('turns `[!TIP] ` typed at a line start into a callout', () => {
    const { editor } = open('[!TIP]');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, ' ');
    expect(editor.state.doc.firstChild).toMatchObject({
      type: { name: 'callout' },
      attrs: { kind: 'tip' },
    });
  });

  it('turns a fresh quote into a callout rather than nesting one in it', () => {
    const { editor } = open('> quote');
    // A quote holding only the typed marker, as `> ` then `[!NOTE]` leaves it.
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '[!NOTE]' }],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    typeText(editor, ' ');
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe('callout');
    expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe(
      'paragraph',
    );
  });

  it('leaves a titled marker a plain quote and an irregular one as source', () => {
    expect(
      open('> [!NOTE] Titled\n> body').editor.state.doc.firstChild?.type.name,
    ).toBe('blockquote');
    // A lazy line is part of the quote in Markdown, but not of the callout the
    // schema can hold; the whole block stays source rather than half-converted.
    const lazy = '> [!NOTE]\n> body\nlazy';
    const { editor, document } = open(lazy);
    expect(editor.state.doc.firstChild?.type.name).toBe('sourceBlock');
    expect(document.serialize(editor)).toBe(lazy);
    const nested = '- item\n  > [!NOTE]\n  > body';
    const reopened = open(nested);
    expect(reopened.editor.state.doc.firstChild?.type.name).toBe('sourceBlock');
    expect(reopened.document.serialize(reopened.editor)).toBe(nested);
  });

  it('renders on the page what the editor serializes', () => {
    const { editor, document } = open('> [!NOTE]\n> Hi.');
    editor.commands.insertContentAt(2, 'Oh, ');
    const html = renderNote(document.serialize(editor)).html;
    expect(html).toContain('callout callout--note');
    expect(html).toContain('Oh, Hi.');
  });
});

describe('footnotes', () => {
  const body = 'Text[^1] and more[^note].\n\n[^1]: First.\n\n[^note]: Second.';

  it('parses references inline and definitions as blocks, losslessly', () => {
    const { editor, document } = open(body);
    const [paragraph, first, second] = editor.getJSON().content!;
    expect(paragraph?.content?.map((node) => node.type)).toEqual([
      'text',
      'footnoteRef',
      'text',
      'footnoteRef',
      'text',
    ]);
    expect(first).toMatchObject({
      type: 'footnoteDefinition',
      attrs: { id: '1' },
    });
    expect(second).toMatchObject({ attrs: { id: 'note' } });
    expect(document.serialize(editor)).toBe(body);
  });

  it('writes edited references and definitions back unchanged in shape', () => {
    const { editor, document } = open(body);
    editor.commands.insertContentAt(1, 'So: ');
    editor.commands.insertContentAt(
      editor.state.doc.content.size - 2,
      ' Also.',
    );
    const saved = document.serialize(editor);
    expect(saved).toBe(
      'So: Text[^1] and more[^note].\n\n[^1]: First.\n\n[^note]: Second. Also.',
    );
    expect(open(saved).editor.getJSON()).toEqual(editor.getJSON());
  });

  it('keeps multi-paragraph definitions together across blank lines', () => {
    const multi =
      'A[^n]\n\n[^n]: First.\n    Same paragraph.\n\n    Second.\n\nAfter.';
    const { editor, document } = open(multi);
    expect(editor.state.doc.childCount).toBe(3);
    const definition = editor.state.doc.child(1);
    expect(definition.type.name).toBe('footnoteDefinition');
    expect(definition.childCount).toBe(2);
    expect(document.serialize(editor)).toBe(multi);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'x');
    const reopened = open(document.serialize(editor)).editor;
    expect(reopened.getJSON()).toEqual(editor.getJSON());
  });

  it('starts a definition on its own line even straight under text', () => {
    const { editor } = open('Line[^1]\n[^1]: Note.');
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.lastChild?.type.name).toBe('footnoteDefinition');
  });

  it('numbers references in reading order and flags loose ends', () => {
    const { editor } = open(
      'B[^b] A[^a] C[^c].\n\n[^a]: a\n\n[^b]: b\n\n[^spare]: s',
    );
    const chips = [...editor.view.dom.querySelectorAll('[data-footnote-ref]')];
    expect(
      chips.map((chip) => chip.getAttribute('data-footnote-number')),
    ).toEqual(['1', '2', '3']);
    // `c` is referenced but never defined.
    expect(chips[2]?.classList.contains('is-orphan')).toBe(true);
    expect(chips[0]?.classList.contains('is-orphan')).toBe(false);
    const definitions = [
      ...editor.view.dom.querySelectorAll('[data-footnote-definition]'),
    ];
    expect(
      definitions.map((el) => el.getAttribute('data-footnote-number')),
    ).toEqual(['2', '1', '']);
    // `spare` is defined but nothing points at it.
    expect(definitions[2]?.classList.contains('is-unused')).toBe(true);
  });

  it('inserts a reference and an empty definition, then lets you type it', () => {
    const { editor, document } = open('Claim.');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(insertFootnote(editor)).toBe(true);
    editor.commands.insertContent('Because.');
    expect(document.serialize(editor)).toBe('Claim.[^1]\n\n[^1]: Because.');
    editor.commands.setTextSelection(2);
    expect(insertFootnote(editor)).toBe(true);
    expect(document.serialize(editor)).toContain('[^2]:');
    expect(footnoteIds(editor.state.doc).sort()).toEqual(['1', '1', '2', '2']);
  });

  it('will not put a reference inside code', () => {
    const { editor } = open('```\ncode\n```');
    editor.commands.setTextSelection(3);
    expect(insertFootnote(editor)).toBe(false);
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('jumps between a reference and its text', () => {
    const { editor } = open('Claim[^1].\n\n[^1]: Because.');
    expect(jumpToDefinition(editor, '1')).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe('Because.');
    expect(jumpToReference(editor, '1')).toBe(true);
    expect(editor.state.selection.constructor.name).toBe('NodeSelection');
    expect(jumpToDefinition(editor, 'missing')).toBe(false);
  });

  it('turns `[^1]` typed in text into a reference', () => {
    const { editor } = open('See [^2');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, ']');
    expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe(
      'footnoteRef',
    );
    expect(editor.state.doc.firstChild?.lastChild?.attrs.id).toBe('2');
  });

  it('leaves ids it cannot give a node as source', () => {
    const odd = 'Odd[^a note].\n\n[^a note]: Spaces.';
    const { editor, document } = open(odd);
    expect(
      editor.getJSON().content?.every((node) => node.type === 'sourceBlock'),
    ).toBe(true);
    expect(document.serialize(editor)).toBe(odd);
  });

  it('serializes to what the page lists as footnotes', () => {
    const { editor, document } = open(body);
    const html = renderNote(document.serialize(editor)).html;
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('id="fn-note"');
    expect(html).toContain('Footnote 2');
  });
});
