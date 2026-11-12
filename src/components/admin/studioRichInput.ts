import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { MutableRef } from 'preact/hooks';
import type { WikiSuggestion } from './WikiLinkAutocomplete';
import { findWikiSuggestion } from './studioRichSuggestions';
import {
  bareUrl,
  markdownFromClipboard,
  pastesAsMarkdown,
} from './studioPaste';

// Paste, file drops, and clicks on the rich editor's own nodes. Like the
// keymap, these handlers are built once with the editor, so they reach the
// component only through refs and functions that read refs.

export function richPaste(
  editor: Editor,
  event: ClipboardEvent,
  actions: {
    upload: (file: File) => void;
    insertMarkdown: (markdown: string) => void;
  },
): boolean {
  const image = Array.from(event.clipboardData?.files ?? []).find((file) =>
    file.type.startsWith('image/'),
  );
  if (image) {
    actions.upload(image);
    return true;
  }
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const href = bareUrl(text);
  if (href !== null && !editor.state.selection.empty) {
    editor.commands.setLink({ href });
    return true;
  }
  // The schema's HTML parser handles normal rich clipboard contents.
  // Plain Markdown is imported directly into the writing surface.
  if (!event.clipboardData?.getData('text/html')) {
    const markdown = markdownFromClipboard(event.clipboardData);
    if (pastesAsMarkdown(markdown)) {
      actions.insertMarkdown(markdown);
      return true;
    }
  }
  return false;
}

/** The part of a drop that is not a block move: an image file to upload. */
export function richFileDrop(
  editor: Editor,
  view: EditorView,
  event: DragEvent,
  upload: (file: File) => void,
): boolean {
  // Preserve native text-selection drags and explicit copy modifiers.
  if (view.dragging) return false;
  const hit = editor.view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  const image = Array.from(event.dataTransfer?.files ?? []).find((file) =>
    file.type.startsWith('image/'),
  );
  if (image) {
    if (hit) editor.commands.setTextSelection(hit.pos);
    upload(image);
    return true;
  }
  return false;
}

export interface RichClickContext {
  suggestions: () => WikiSuggestion[];
  editImage: (node: PMNode) => void;
  /** The last tap on an image, so a quick second tap opens its editor. */
  imageTap: MutableRef<{ pos: number; time: number }>;
  editSource: (from: number, raw: string) => void;
}

/** ProseMirror's `handleClickOn` for the rich editor. */
export function richClickOn(
  editor: Editor,
  node: PMNode,
  nodePos: number,
  event: MouseEvent,
  context: RichClickContext,
): boolean {
  const { imageTap } = context;
  if (event.metaKey || event.ctrlKey) {
    const suggestion =
      node.type.name === 'wikiLink'
        ? findWikiSuggestion(context.suggestions(), node.attrs.target)
        : null;
    const href =
      suggestion?.href ??
      (event.target as HTMLElement).closest('a')?.getAttribute('href');
    if (href) {
      const url = URL.parse(href, window.location.href);
      if (url && ['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        event.preventDefault();
        window.open(url.href, '_blank', 'noopener,noreferrer');
        return true;
      }
    }
  }
  if (node.type.name === 'image') {
    if ((event.target as HTMLElement).closest('[data-write-below-image]')) {
      const after = nodePos + node.nodeSize;
      const next = editor.state.doc.nodeAt(after);
      const chain = editor.chain();
      if (!next?.isTextblock)
        chain.insertContentAt(after, { type: 'paragraph' });
      chain
        .setTextSelection(after + 1)
        .focus()
        .run();
      imageTap.current = { pos: -1, time: 0 };
      return true;
    }
    const now = Date.now();
    if (imageTap.current.pos === nodePos && now - imageTap.current.time < 350) {
      imageTap.current = { pos: -1, time: 0 };
      context.editImage(node);
      return true;
    }
    imageTap.current = { pos: nodePos, time: now };
    return false;
  }
  if (
    node.type.name !== 'sourceBlock' ||
    (event.detail !== 2 &&
      !(event.target as HTMLElement).closest('[data-edit-source]'))
  )
    return false;
  context.editSource(nodePos, node.attrs.raw);
  return true;
}
