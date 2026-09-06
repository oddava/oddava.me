import {
  Node,
  nodeInputRule,
  type Editor,
  type JSONContent,
} from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { parseBlocks } from './studioBlocks';

/** An explicit, lossless escape hatch for authored HTML and custom syntax. */
export const SourceBlock = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    raw: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-source-raw') ?? '',
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-source-block]' }],
  renderHTML: ({ node }) => [
    'div',
    {
      'data-source-block': '',
      'data-source-raw': node.attrs.raw,
      class: 'studio-source-block',
    },
    ['span', { class: 'studio-source-block__label' }, 'Custom Markdown'],
    ['pre', {}, node.attrs.raw],
    [
      'button',
      { type: 'button', 'data-edit-source': '', contenteditable: 'false' },
      'Edit source',
    ],
  ],
  renderMarkdown: (node) => node.attrs?.raw ?? '',
});

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    target: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-wiki-link') ?? '',
    },
    label: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-wiki-label') ?? '',
    },
  }),
  parseHTML: () => [{ tag: 'span[data-wiki-link]' }],
  renderHTML: ({ node }) => [
    'span',
    {
      'data-wiki-link': node.attrs.target,
      'data-wiki-label': node.attrs.label,
      class: 'studio-wiki-chip',
      title: node.attrs.target,
    },
    node.attrs.label || node.attrs.target,
  ],
  renderText: ({ node }) => node.attrs.label || node.attrs.target,
  addInputRules() {
    return [
      nodeInputRule({
        find: /\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/,
        type: this.type,
        getAttributes: (match) => ({ target: match[1], label: match[2] ?? '' }),
      }),
    ];
  },
  markdownTokenName: 'wikiLink',
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize: (src) => {
      const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
      return match
        ? {
            type: 'wikiLink',
            raw: match[0],
            target: match[1],
            label: match[2] || '',
          }
        : undefined;
    },
  },
  parseMarkdown: (token) => ({
    type: 'wikiLink',
    attrs: { target: token.target, label: token.label },
  }),
  renderMarkdown: (node) =>
    `[[${node.attrs?.target}${node.attrs?.label ? `|${node.attrs.label}` : ''}]]`,
});

interface OriginalBlock {
  raw: string;
  gap: string;
}

/**
 * ProseMirror nodes are immutable. Unchanged siblings (and history snapshots)
 * retain their identity, so they can retain their exact authored Markdown too.
 * Only edited blocks go through the Markdown serializer. This is deliberately
 * outside persistence: the server still receives its original string model.
 */
export class RichDocument {
  private originals = new WeakMap<ProseNode, OriginalBlock>();
  private trailing = '';
  private leading = '';
  private spellings = new Map<string, string>();

  parse(editor: Editor, source: string): JSONContent {
    const content: JSONContent[] = [];
    const hasReferences = /^ {0,3}\[[^\]]+\]:/m.test(source);
    for (const block of parseBlocks(source)) {
      // HTML, reference definitions and inline HTML cannot safely be reduced
      // to the rich schema. Keep these editable in an explicit source card.
      const custom =
        (block.type !== 'code' &&
          (/\[\^[^\]]+\]|\[[^\]]+\]\[[^\]]*\]/.test(block.raw) ||
            (hasReferences && /\[[^\]]+\]/.test(block.raw)))) ||
        block.type === 'html' ||
        /^\s*</.test(block.raw) ||
        (block.type !== 'code' &&
          /<\/?[a-z][^>]*>|^\s*\[[^\]]+\]:/im.test(block.raw));
      const parsed = custom
        ? []
        : (editor.markdown!.parse(block.raw).content ?? []);
      if (parsed.length === 1) content.push(parsed[0]!);
      else content.push({ type: 'sourceBlock', attrs: { raw: block.raw } });
    }
    return {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    };
  }

  remember(editor: Editor, source: string) {
    this.originals = new WeakMap();
    const blocks = parseBlocks(source);
    this.leading = source.slice(0, blocks[0]?.start ?? 0);
    this.spellings.clear();
    let end = 0;
    editor.state.doc.forEach((node, _offset, index) => {
      const block = blocks[index];
      if (!block) return;
      this.originals.set(node, {
        raw: block.raw,
        gap: source.slice(end, block.start),
      });
      this.spellings.set(JSON.stringify(node.toJSON()), block.raw);
      end = block.end;
    });
    this.trailing = source.slice(end);
  }

  serialize(editor: Editor): string {
    let result = '';
    editor.state.doc.forEach((node, _offset, index) => {
      const original = this.originals.get(node);
      const raw =
        original?.raw ??
        this.spellings.get(JSON.stringify(node.toJSON())) ??
        (node.type.name === 'sourceBlock'
          ? (node.attrs.raw as string)
          : editor.markdown!.serialize({
              type: 'doc',
              content: [node.toJSON()],
            }));
      const gap = index === 0 ? this.leading : original?.gap || '\n\n';
      result += gap + raw;
    });
    return result + this.trailing;
  }
}
