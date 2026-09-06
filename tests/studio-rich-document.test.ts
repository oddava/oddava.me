// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
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
      '<figure><img src="/image.png" width="300" /><figcaption>Caption</figcaption></figure>\n\n[ref]: https://example.com';
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
