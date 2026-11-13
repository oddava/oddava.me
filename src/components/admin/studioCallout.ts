import {
  InputRule,
  Node as TiptapNode,
  type NodeViewRendererProps,
} from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { findWrapping } from '@tiptap/pm/transform';
import {
  CALLOUT_KINDS,
  CALLOUTS,
  calloutIconSvg,
  isCalloutKind,
  writeCallout,
  type CalloutKind,
} from '../../lib/garden/callouts';
import { openPicker, type PickerOption } from './studioPicker';

// A callout is a real node, not a styled blockquote: its kind is an attribute,
// its body is ordinary blocks, and it writes back as `> [!KIND]` — the syntax
// the page renders (see lib/garden/callouts.ts).

const KIND_OPTIONS: PickerOption[] = CALLOUT_KINDS.map((kind) => ({
  id: kind,
  label: CALLOUTS[kind].label,
  hint: `[!${kind.toUpperCase()}]`,
  tone: kind,
}));

function calloutView({ node: initial, editor, getPos }: NodeViewRendererProps) {
  let node = initial;
  let shownKind: CalloutKind | null = null;

  const dom = document.createElement('div');
  dom.setAttribute('role', 'note');
  const title = document.createElement('div');
  title.className = 'callout__title';
  title.contentEditable = 'false';
  const kindButton = document.createElement('button');
  kindButton.type = 'button';
  kindButton.className = 'callout__kind';
  kindButton.dataset.blockControl = '';
  kindButton.setAttribute('aria-haspopup', 'listbox');
  kindButton.setAttribute('aria-expanded', 'false');
  title.append(kindButton);
  const body = document.createElement('div');
  body.className = 'callout__body';
  dom.append(title, body);

  function render() {
    const kind: CalloutKind = isCalloutKind(node.attrs.kind)
      ? node.attrs.kind
      : 'note';
    dom.className = `callout callout--${kind}`;
    kindButton.textContent = CALLOUTS[kind].label;
    kindButton.setAttribute(
      'aria-label',
      `Callout kind: ${CALLOUTS[kind].label}. Change kind`,
    );
    if (shownKind !== kind) {
      title.querySelector('.callout__icon')?.remove();
      // Static markup from our own table; nothing the author wrote reaches it.
      title.insertAdjacentHTML('afterbegin', calloutIconSvg(kind));
      shownKind = kind;
    }
  }

  function choose(kind: string) {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind }),
    );
    editor.view.focus();
  }

  kindButton.addEventListener('click', () =>
    openPicker({
      anchor: kindButton,
      title: 'Callout kind',
      options: KIND_OPTIONS,
      current: String(node.attrs.kind),
      onPick: choose,
    }),
  );
  render();

  return {
    dom,
    contentDOM: body,
    update(next: ProseNode) {
      if (next.type !== node.type) return false;
      node = next;
      render();
      return true;
    },
    stopEvent: (event: Event) =>
      event.target instanceof Node && kindButton.contains(event.target),
    ignoreMutation: (mutation: { target: Node }) =>
      !body.contains(mutation.target),
  };
}

export const Callout = TiptapNode.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    kind: {
      default: 'note',
      parseHTML: (element) => {
        const kind = element.getAttribute('data-callout');
        return isCalloutKind(kind) ? kind : 'note';
      },
    },
  }),
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ node }) => [
    'div',
    {
      'data-callout': node.attrs.kind,
      class: `callout callout--${node.attrs.kind}`,
      role: 'note',
    },
    0,
  ],
  renderMarkdown: (node, helpers) =>
    writeCallout(
      isCalloutKind(node.attrs?.kind) ? node.attrs.kind : 'note',
      helpers.renderChildren(node.content ?? [], '\n\n'),
    ),
  addNodeView() {
    return (props) => calloutView(props);
  },
  addCommands() {
    return {
      /** Wrap the current block in a callout, or retarget the one it is in. */
      setCallout:
        (kind: CalloutKind = 'note') =>
        ({ commands }) =>
          this.editor.isActive(this.name)
            ? commands.updateAttributes(this.name, { kind })
            : commands.wrapIn(this.name, { kind }),
    };
  },
  addInputRules() {
    const type = this.type;
    // `[!NOTE] ` at the start of a line. After `> ` the line is already a quote
    // holding only this text; that quote becomes the callout instead of
    // nesting one inside it.
    return [
      new InputRule({
        find: new RegExp(`^\\s*\\[!(${CALLOUT_KINDS.join('|')})\\]\\s$`, 'i'),
        handler: ({ state, range, match }) => {
          const attrs = { kind: match[1]!.toLowerCase() };
          const tr = state.tr.delete(range.from, range.to);
          const $start = tr.doc.resolve(range.from);
          const quote =
            $start.depth >= 2 ? $start.node($start.depth - 1) : null;
          if (quote?.type.name === 'blockquote' && quote.childCount === 1) {
            tr.setNodeMarkup($start.before($start.depth - 1), type, attrs);
            return;
          }
          const blockRange = $start.blockRange();
          const wrapping = blockRange && findWrapping(blockRange, type, attrs);
          if (!blockRange || !wrapping) return null;
          tr.wrap(blockRange, wrapping);
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: CalloutKind) => ReturnType;
    };
  }
}
