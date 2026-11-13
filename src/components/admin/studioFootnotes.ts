import {
  Extension,
  Node as TiptapNode,
  nodeInputRule,
  type Editor,
} from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  FOOTNOTE_ID,
  footnoteNumbers,
  readFootnoteReference,
  writeFootnoteDefinition,
} from '../../lib/garden/footnotes';
import { isMod } from './studioHelpers';
import { OVERLAYS } from './studioLayers';

// Footnotes as two real nodes: an inline reference (`[^1]`) and a definition
// block (`[^1]: text`). Numbers are not stored — they are the order references
// appear in, the same rule the page uses — so the editor draws them as
// decorations and the Markdown keeps the author's own ids.

const numbering = new PluginKey<DecorationSet>('studioFootnoteNumbers');

interface Footnote {
  node: ProseNode;
  pos: number;
}

function footnotesIn(doc: ProseNode) {
  const references: Footnote[] = [];
  const definitions = new Map<string, Footnote>();
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef') references.push({ node, pos });
    else if (
      node.type.name === 'footnoteDefinition' &&
      !definitions.has(node.attrs.id)
    )
      definitions.set(node.attrs.id, { node, pos });
    return true;
  });
  return { references, definitions };
}

/** Existing ids, so a new footnote never reuses one. */
export function footnoteIds(doc: ProseNode): string[] {
  const { references, definitions } = footnotesIn(doc);
  return [...references.map((ref) => ref.node.attrs.id), ...definitions.keys()];
}

function numberFootnotes(doc: ProseNode): DecorationSet {
  const { references, definitions } = footnotesIn(doc);
  const numbers = footnoteNumbers(references.map((ref) => ref.node.attrs.id));
  const decorations: Decoration[] = [];
  for (const { node, pos } of references) {
    const number = numbers.get(node.attrs.id)!;
    const defined = definitions.has(node.attrs.id);
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-footnote-number': String(number),
        'aria-label': defined
          ? `Footnote ${number}. Go to its text`
          : `Footnote ${number} has no text yet`,
        class: defined ? '' : 'is-orphan',
      }),
    );
  }
  for (const [id, { node, pos }] of definitions) {
    const number = numbers.get(id);
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-footnote-number': number ? String(number) : '',
        class: number ? '' : 'is-unused',
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function select(editor: Editor, pos: number, node: ProseNode | null) {
  const { tr, doc } = editor.state;
  tr.setSelection(
    node
      ? NodeSelection.create(doc, pos)
      : TextSelection.near(doc.resolve(pos)),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** Move the caret into a footnote's text. */
export function jumpToDefinition(editor: Editor, id: string): boolean {
  const found = footnotesIn(editor.state.doc).definitions.get(id);
  if (!found) return false;
  // +2 steps over the definition's and its first block's opening tokens.
  select(editor, found.pos + 2, null);
  return true;
}

/** Select the first place a footnote is referenced. */
export function jumpToReference(editor: Editor, id: string): boolean {
  const found = footnotesIn(editor.state.doc).references.find(
    (ref) => ref.node.attrs.id === id,
  );
  if (!found) return false;
  select(editor, found.pos, found.node);
  return true;
}

/** The id of the footnote whose text holds the caret, if it is in one. */
export function footnoteAtCaret(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'footnoteDefinition') return node.attrs.id;
  }
  return null;
}

/**
 * The keyboard's way back from a footnote's text to where it is used — the
 * ↩ mark's job, which a pointer reaches but Tab cannot (it lives inside the
 * editable page). Mod+Enter always; Escape too, unless something open on the
 * page (a menu, find, a dialog) is what that Escape is for. Consumed keys
 * stop here, so the page's own Escape does not also act.
 */
export function returnFromFootnote(
  editor: Editor,
  event: KeyboardEvent,
): boolean {
  const back =
    (event.key === 'Enter' &&
      isMod(event) &&
      !event.shiftKey &&
      !event.altKey) ||
    (event.key === 'Escape' &&
      !event.shiftKey &&
      !isMod(event) &&
      !document.querySelector(OVERLAYS));
  if (!back) return false;
  const id = footnoteAtCaret(editor);
  if (id === null || !jumpToReference(editor, id)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** A finger rather than a mouse: a tap must not be a jump on its own. */
function coarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches
  );
}

/**
 * Whether a press on the reference at `pos` follows it to its text. A mouse
 * follows at once. A finger selects first and follows only a reference that
 * was already selected, because a fingertip lands on a superscript number
 * while aiming at the words around it far more often than on purpose.
 */
export function followsReference(
  coarse: boolean,
  selectedRef: number | null,
  pos: number,
): boolean {
  return !coarse || selectedRef === pos;
}

export const FootnoteRef = TiptapNode.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: {
      default: '1',
      parseHTML: (element) => element.getAttribute('data-footnote-ref') ?? '1',
    },
  }),
  parseHTML: () => [{ tag: 'sup[data-footnote-ref]' }],
  renderHTML: ({ node }) => [
    'sup',
    {
      'data-footnote-ref': node.attrs.id,
      class: 'studio-footnote-ref',
      role: 'doc-noteref',
    },
  ],
  renderText: ({ node }) => `[^${node.attrs.id}]`,
  markdownTokenName: 'footnoteRef',
  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline',
    start: (src) => src.indexOf('[^'),
    tokenize: (src) => {
      const reference = readFootnoteReference(src);
      return reference ? { type: 'footnoteRef', ...reference } : undefined;
    },
  },
  parseMarkdown: (token) => ({
    type: 'footnoteRef',
    attrs: { id: token.id },
  }),
  renderMarkdown: (node) => `[^${node.attrs?.id}]`,
  addInputRules() {
    return [
      nodeInputRule({
        // No capture group: with one, the rule would replace only the id.
        find: new RegExp(`\\[\\^${FOOTNOTE_ID}\\]$`),
        type: this.type,
        getAttributes: (match) => ({ id: match[0].slice(2, -1) }),
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      // A selected reference is a link: Enter follows it.
      Enter: () => {
        const { selection } = this.editor.state;
        return (
          selection instanceof NodeSelection &&
          selection.node.type === this.type &&
          jumpToDefinition(this.editor, selection.node.attrs.id)
        );
      },
    };
  },
});

export const FootnoteDefinition = TiptapNode.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes: () => ({
    id: {
      default: '1',
      parseHTML: (element) =>
        element.getAttribute('data-footnote-definition') ?? '1',
    },
  }),
  parseHTML: () => [{ tag: 'div[data-footnote-definition]' }],
  renderHTML: ({ node }) => [
    'div',
    {
      'data-footnote-definition': node.attrs.id,
      class: 'studio-footnote',
      role: 'doc-endnote',
    },
    [
      'button',
      {
        type: 'button',
        class: 'studio-footnote__mark',
        contenteditable: 'false',
        'data-footnote-jump': node.attrs.id,
        'aria-label': 'Back to where this footnote is used',
        // Inside the editable page Tab never reaches it; these do, from the
        // footnote's text (see `returnFromFootnote`).
        'aria-keyshortcuts': 'Escape',
        title: 'Back to where it is used (Esc)',
      },
    ],
    ['div', { class: 'studio-footnote__body' }, 0],
  ],
  renderMarkdown: (node, helpers) =>
    writeFootnoteDefinition(
      node.attrs?.id,
      helpers.renderChildren(node.content ?? [], '\n\n'),
    ),
});

/** Numbers and follows footnotes; the two nodes stay inert without it. */
export const FootnoteBehavior = Extension.create({
  name: 'footnoteBehavior',
  addProseMirrorPlugins() {
    const editor = this.editor;
    /** The reference a first tap selected, which a second tap follows. */
    let tapped: number | null = null;
    return [
      new Plugin<DecorationSet>({
        key: numbering,
        state: {
          init: (_config, state) => numberFootnotes(state.doc),
          apply: (tr, previous) =>
            tr.docChanged ? numberFootnotes(tr.doc) : previous,
        },
        props: {
          decorations: (state) => numbering.getState(state),
          handleClickOn: (view, _pos, node, nodePos, event, direct) => {
            if (!direct || node.type.name !== 'footnoteRef') return false;
            const { selection } = view.state;
            const selected =
              selection instanceof NodeSelection && selection.from === nodePos
                ? nodePos
                : tapped;
            if (followsReference(coarsePointer(), selected, nodePos)) {
              tapped = null;
              return jumpToDefinition(editor, node.attrs.id);
            }
            // First tap: select it, so the second is a deliberate follow.
            event.preventDefault();
            tapped = nodePos;
            view.dispatch(
              view.state.tr.setSelection(
                NodeSelection.create(view.state.doc, nodePos),
              ),
            );
            return true;
          },
          // Two quick taps reach ProseMirror as a double click, not as a
          // second single one: the first selected the reference, so this
          // one follows it.
          handleDoubleClickOn: (
            _view,
            _pos,
            node,
            _nodePos,
            _event,
            direct,
          ) => {
            if (!direct || node.type.name !== 'footnoteRef') return false;
            tapped = null;
            return jumpToDefinition(editor, node.attrs.id);
          },
          handleClick: (_view, _pos, event) => {
            tapped = null;
            if (!(event.target instanceof Element)) return false;
            const back = event.target.closest('[data-footnote-jump]');
            return back
              ? jumpToReference(
                  editor,
                  back.getAttribute('data-footnote-jump')!,
                )
              : false;
          },
        },
      }),
    ];
  },
});
