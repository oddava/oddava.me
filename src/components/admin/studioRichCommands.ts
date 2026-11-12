import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type Transaction } from '@tiptap/pm/state';
import type { MutableRef } from 'preact/hooks';
import { BlockSelection } from './studioBlockSelection';
import type {
  EditorCommands,
  ImageMarkupOptions,
} from './studioEditorCommands';
import type { ImageEditRequest } from './StudioImageDialog';
import { moveBlocksTo } from './studioSideDrop';
import type { RichDocument } from './studioRichDocument';
import { topBlock } from './studioRichGeometry';

// What the rich editor does to its document on request: the command set the
// toolbar and slash menu share, Markdown insertion, and image uploads.

export function insertMarkdownInto(
  editor: Editor,
  source: RichDocument,
  markdown: string,
) {
  const content = source.parse(editor, markdown).content ?? [];
  if (editor.state.selection instanceof BlockSelection) {
    editor.view.dispatch(
      editor.state.tr
        .replaceSelection(
          new Slice(
            Fragment.from(
              content.map((node) => editor.schema.nodeFromJSON(node)),
            ),
            0,
            0,
          ),
        )
        .scrollIntoView(),
    );
    editor.view.focus();
  } else editor.chain().focus().insertContent(content).run();
}

/**
 * A link a note may point at: the web, email, or a path on this site. An
 * empty destination is allowed too — applying it removes the link.
 */
export function isAllowedLinkUrl(url: string): boolean {
  return !url || /^(https?:\/\/|mailto:|\/|#)/i.test(url);
}

/**
 * Where a node object sits in the document now, or null once it is gone.
 * Stops at the first match instead of walking the rest of the document.
 */
export function findNodePosition(doc: PMNode, node: PMNode): number | null {
  let position: number | null = null;
  doc.descendants((candidate, pos) => {
    if (position !== null) return false;
    if (candidate === node) {
      position = pos;
      return false;
    }
    return true;
  });
  return position;
}

const IMAGE_GONE = 'This image is no longer in the document.';

/** New attributes for an image node, or null to delete it. */
export function changeImageNode(
  editor: Editor,
  node: PMNode,
  attrs: Record<string, unknown> | null,
  onNotice: (message: string) => void,
) {
  const position = findNodePosition(editor.state.doc, node);
  if (position === null) {
    onNotice(IMAGE_GONE);
    return;
  }
  if (attrs)
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        ...attrs,
      }),
    );
  else
    editor.commands.deleteRange({
      from: position,
      to: position + node.nodeSize,
    });
  editor.commands.focus();
}

/** Open the image dialog on an image; its markup replaces the node. */
export function requestImageEdit(
  editor: Editor,
  node: PMNode,
  source: MutableRef<RichDocument>,
  actions: {
    onRequestImage: (request: ImageEditRequest) => void;
    onNotice: (message: string) => void;
  },
) {
  actions.onRequestImage({
    image: node.attrs as ImageMarkupOptions,
    onSubmit: (markup) => {
      if (editor.isDestroyed) return;
      const position = findNodePosition(editor.state.doc, node);
      if (position === null) {
        actions.onNotice(IMAGE_GONE);
        return;
      }
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: position, to: position + node.nodeSize },
          source.current.parse(editor, markup).content ?? [],
        )
        .run();
    },
  });
}

/** Alt+↑/↓ on a block selection: the whole run hops its neighbour. */
export function moveSelectedBlocks(
  editor: Editor,
  selection: BlockSelection,
  direction: -1 | 1,
) {
  const positions = selection.positions;
  const first = positions[0]!;
  const last = positions.at(-1)!;
  const end = last + editor.state.doc.nodeAt(last)!.nodeSize;
  const neighbor =
    direction < 0
      ? editor.state.doc.resolve(first).nodeBefore
      : editor.state.doc.nodeAt(end);
  if (neighbor)
    moveBlocksTo(
      editor,
      positions,
      direction < 0 ? first - neighbor.nodeSize : end + neighbor.nodeSize,
    );
}

/**
 * Swap the top-level block at `at` with its neighbour and select it. Returns
 * where it landed, or null when there was nothing to swap with.
 */
export function moveTopBlock(
  editor: Editor,
  at: number,
  direction: -1 | 1,
): number | null {
  const block = topBlock(editor, at);
  if (!block) return null;
  const { from, node } = block;
  const neighbor =
    direction < 0
      ? editor.state.doc.resolve(from).nodeBefore
      : editor.state.doc.nodeAt(from + node.nodeSize);
  if (!neighbor) return null;
  const target =
    direction < 0 ? from - neighbor.nodeSize : from + neighbor.nodeSize;
  const tr = editor.state.tr
    .delete(from, from + node.nodeSize)
    .insert(target, node);
  tr.setSelection(NodeSelection.create(tr.doc, target));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return target;
}

// Asynchronous uploads track their insertion bookmark through every edit.
export async function uploadImageAtSelection(
  editor: Editor,
  source: MutableRef<RichDocument>,
  file: File,
  upload: (file: File) => Promise<string | null>,
) {
  let position = editor.state.selection.from;
  const original = source.current;
  const map = ({ transaction }: { transaction: Transaction }) => {
    position = transaction.mapping.map(position);
  };
  editor.on('transaction', map);
  try {
    const url = await upload(file);
    if (url && !editor.isDestroyed && source.current === original) {
      editor.commands.insertContentAt(position, {
        type: 'image',
        attrs: { src: url, alt: file.name.replace(/\.[^.]+$/, '') },
      });
    }
  } finally {
    editor.off('transaction', map);
  }
}

export function createEditorCommands(
  editor: Editor,
  actions: { showLink: () => void; insertMarkdown: (markdown: string) => void },
): EditorCommands {
  const { showLink, insertMarkdown } = actions;
  return {
    bold: () => {
      editor.chain().focus().toggleBold().run();
    },
    italic: () => {
      editor.chain().focus().toggleItalic().run();
    },
    strike: () => {
      editor.chain().focus().toggleStrike().run();
    },
    inlineCode: () => {
      editor.chain().focus().toggleCode().run();
    },
    heading: (level) => {
      editor.chain().focus().toggleHeading({ level }).run();
    },
    bulletList: () => {
      editor.chain().focus().toggleBulletList().run();
    },
    orderedList: () => {
      editor.chain().focus().toggleOrderedList().run();
    },
    taskList: () => {
      editor.chain().focus().toggleTaskList().run();
    },
    quote: () => {
      editor.chain().focus().toggleBlockquote().run();
    },
    codeBlock: () => {
      editor.chain().focus().toggleCodeBlock().run();
    },
    divider: () => {
      editor.chain().focus().setHorizontalRule().run();
    },
    table: () => {
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
    link: showLink,
    align: (direction) => {
      const block = topBlock(editor);
      if (!block) return;
      const raw = editor.markdown!.serialize({
        type: 'doc',
        content: [block.node.toJSON()],
      });
      editor.commands.insertContentAt(
        { from: block.from, to: block.from + block.node.nodeSize },
        {
          type: 'sourceBlock',
          attrs: {
            raw: `<div style="text-align:${direction}">\n\n${raw}\n\n</div>`,
          },
        },
      );
    },
    insertBlock: insertMarkdown,
    insertInline: (snippet) => {
      if (snippet === '[[') editor.chain().focus().insertContent('[[').run();
      else insertMarkdown(snippet);
    },
  };
}

/** What each slash-menu row does once its typed `/query` is gone. */
export function slashActions(
  editor: Editor,
  commands: EditorCommands,
  handlers: {
    requestImage: () => void;
    embedYoutube: () => void;
    showLink: () => void;
  },
): Record<string, () => void> {
  return {
    text: () => editor.commands.setParagraph(),
    h1: () => commands.heading(1),
    h2: () => commands.heading(2),
    h3: () => commands.heading(3),
    h4: () => commands.heading(4),
    h5: () => commands.heading(5),
    h6: () => commands.heading(6),
    bullet: commands.bulletList,
    ordered: commands.orderedList,
    task: commands.taskList,
    quote: commands.quote,
    code: commands.codeBlock,
    table: commands.table,
    divider: commands.divider,
    image: handlers.requestImage,
    youtube: handlers.embedYoutube,
    link: handlers.showLink,
    wikilink: () => editor.commands.insertContent('[['),
    date: () =>
      editor.commands.insertContent(
        new Date().toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      ),
  };
}
