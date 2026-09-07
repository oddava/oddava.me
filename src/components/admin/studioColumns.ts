import { Node, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  isolating: true,
  addAttributes: () => ({
    layout: {
      default: 'equal',
      parseHTML: (el) => el.getAttribute('data-layout') ?? 'equal',
    },
  }),
  parseHTML: () => [{ tag: 'div[data-note-columns]' }],
  renderHTML: ({ node }) => [
    'div',
    {
      'data-note-columns': '',
      'data-layout': node.attrs.layout,
      class: `note-columns note-columns--${node.attrs.layout}`,
    },
    0,
  ],
  renderMarkdown: (node, helpers) =>
    `:::columns ${node.attrs?.layout ?? 'equal'}\n${(node.content ?? []).map((column) => helpers.renderChildren(column.content ?? [], '\n\n')).join('\n:::column\n')}\n:::`,
});
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-note-column]' }],
  renderHTML: () => [
    'div',
    { 'data-note-column': '', class: 'note-column' },
    0,
  ],
});

export function makeColumns(editor: Editor, from: number, count = 2) {
  const node = editor.state.doc.nodeAt(from);
  if (!node || node.type.name === 'columns') return;
  const column = editor.schema.nodes.column!;
  const row = editor.schema.nodes.columns!.create(
    { layout: count === 3 ? 'three' : 'equal' },
    [
      column.create(null, node),
      ...Array.from({ length: count - 1 }, () => column.createAndFill()!),
    ],
  );
  const tr = editor.state.tr.replaceWith(from, from + node.nodeSize, row);
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(from + 2 + node.nodeSize + 2)),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export function activeColumns(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'columns')
      return { node: $from.node(depth), from: $from.before(depth) };
  }
  const node = editor.state.doc.nodeAt($from.pos);
  return node?.type.name === 'columns' ? { node, from: $from.pos } : null;
}
