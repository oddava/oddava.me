import CodeBlock from '@tiptap/extension-code-block';
import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  codeLanguageLabel,
  resolveCodeLanguage,
} from '../../lib/garden/code-languages';
import {
  tokenClass,
  tokenizeCode,
  type CodeToken,
} from '../../lib/garden/highlight';
import {
  codeLanguageOptions,
  currentCodeLanguage,
  customLanguageOption,
  languageFromPick,
} from './studioCodeLanguages';
import { openPicker } from './studioPicker';

// Studio's code block: the stock block plus a language chip and syntax
// colours. Colours are decorations that only carry class names, because the
// site's CSP would refuse inline styles — and the page paints the same classes,
// so what you see here is what a reader sees.

const highlightKey = new PluginKey<DecorationSet>('studioCodeHighlight');

// Nodes are immutable: a block that was not edited keeps its tokens.
const tokenCache = new WeakMap<ProseNode, CodeToken[]>();

function tokensOf(node: ProseNode): CodeToken[] {
  let tokens = tokenCache.get(node);
  if (!tokens) {
    tokens = tokenizeCode(node.textContent, node.attrs.language);
    tokenCache.set(node, tokens);
  }
  return tokens;
}

function highlightCode(doc: ProseNode, name: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== name) return true;
    for (const { from, to, kind } of tokensOf(node))
      // +1 steps over the block's opening token to its first character.
      decorations.push(
        Decoration.inline(pos + 1 + from, pos + 1 + to, {
          class: tokenClass(kind),
        }),
      );
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function codeBlockView({
  node: initial,
  editor,
  getPos,
}: NodeViewRendererProps) {
  let node = initial;
  const dom = document.createElement('pre');
  const code = document.createElement('code');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'studio-code-lang';
  chip.contentEditable = 'false';
  chip.dataset.blockControl = '';
  chip.setAttribute('aria-haspopup', 'listbox');
  chip.setAttribute('aria-expanded', 'false');
  dom.append(chip, code);

  function render() {
    const language = resolveCodeLanguage(node.attrs.language);
    const label = codeLanguageLabel(node.attrs.language);
    chip.textContent = label;
    chip.setAttribute('aria-label', `Code language: ${label}. Change language`);
    if (language) dom.dataset.language = language.label;
    else delete dom.dataset.language;
    code.className = node.attrs.language
      ? `language-${node.attrs.language}`
      : '';
  }

  function choose(id: string) {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: languageFromPick(id),
      }),
    );
    editor.view.focus();
  }

  chip.addEventListener('click', () =>
    openPicker({
      anchor: chip,
      title: 'Code language',
      options: codeLanguageOptions(node.attrs.language),
      current: currentCodeLanguage(node.attrs.language),
      searchable: true,
      custom: customLanguageOption,
      onPick: choose,
    }),
  );
  render();

  return {
    dom,
    contentDOM: code,
    update(next: ProseNode) {
      if (next.type !== node.type) return false;
      node = next;
      render();
      return true;
    },
    // The chip is a control, not text: the editor must leave its events alone.
    stopEvent: (event: Event) =>
      event.target instanceof Node && chip.contains(event.target),
    ignoreMutation: (mutation: { target: Node }) =>
      !code.contains(mutation.target),
  };
}

export const RichCodeBlock = CodeBlock.extend({
  addNodeView() {
    return (props) => codeBlockView(props);
  },
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: (_config, state) => highlightCode(state.doc, name),
          apply: (tr, previous) =>
            tr.docChanged ? highlightCode(tr.doc, name) : previous,
        },
        props: {
          decorations: (state) => highlightKey.getState(state),
        },
      }),
    ];
  },
});
