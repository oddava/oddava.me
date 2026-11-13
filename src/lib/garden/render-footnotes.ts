import type { Token, Tokens } from 'marked';
import { readFootnoteDefinition, readFootnoteReference } from './footnotes';

// The marked half of footnotes (syntax lives in footnotes.ts). A render owns a
// `FootnoteState`: definitions found anywhere in the note, and the order the
// references are met in, which is what numbers them. Tokens carry the state to
// the extension renderers, which marked registers once, globally.

export interface FootnoteState {
  definitions: Map<string, FootnoteDefinitionToken>;
  /** Footnote ids in order of first reference. */
  referenced: string[];
  uses: Map<string, number>;
}

export function createFootnoteState(): FootnoteState {
  return { definitions: new Map(), referenced: [], uses: new Map() };
}

interface FootnoteRefToken extends Tokens.Generic {
  id: string;
  state?: FootnoteState;
}

interface FootnoteDefinitionToken extends Tokens.Generic {
  id: string;
  blocks: Token[];
}

const isRef = (token: Token): token is FootnoteRefToken =>
  token.type === 'footnoteRef';
const isDefinition = (token: Token): token is FootnoteDefinitionToken =>
  token.type === 'footnoteDefinition';

/** Collects definitions and hands every reference the state. Run on every token. */
export function trackFootnote(token: Token, state: FootnoteState): void {
  if (isDefinition(token) && !state.definitions.has(token.id))
    state.definitions.set(token.id, token);
  else if (isRef(token)) token.state = state;
}

function noteNumber(state: FootnoteState, id: string): number {
  let index = state.referenced.indexOf(id);
  if (index < 0) index = state.referenced.push(id) - 1;
  return index + 1;
}

const footnoteRefExtension = {
  name: 'footnoteRef',
  level: 'inline' as const,
  start(src: string) {
    const index = src.indexOf('[^');
    return index < 0 ? undefined : index;
  },
  tokenizer(src: string) {
    const reference = readFootnoteReference(src);
    return reference ? { type: 'footnoteRef', ...reference } : undefined;
  },
  renderer(token: Tokens.Generic) {
    if (!isRef(token)) return false;
    const { state, id } = token;
    // A reference nobody defined stays what the author typed.
    if (!state?.definitions.has(id)) return token.raw;
    const number = noteNumber(state, id);
    const uses = (state.uses.get(id) ?? 0) + 1;
    state.uses.set(id, uses);
    const anchor = uses === 1 ? `fnref-${id}` : `fnref-${id}-${uses}`;
    return `<sup class="footnote-ref"><a href="#fn-${id}" id="${anchor}" role="doc-noteref" aria-label="Footnote ${number}">${number}</a></sup>`;
  },
};

const footnoteDefinitionExtension = {
  name: 'footnoteDefinition',
  level: 'block' as const,
  start: (src: string) => src.search(/^ {0,3}\[\^[\w-]+\]:/m),
  tokenizer(
    this: { lexer: { blockTokens(src: string): Token[] } },
    src: string,
  ) {
    const definition = readFootnoteDefinition(src);
    if (!definition) return undefined;
    return {
      type: 'footnoteDefinition',
      raw: definition.raw,
      id: definition.id,
      blocks: this.lexer.blockTokens(definition.body),
    };
  },
  childTokens: ['blocks'],
  // Definitions are gathered at the end of the note, wherever they were written.
  renderer: () => '',
};

export const footnoteExtensions = [
  footnoteRefExtension,
  footnoteDefinitionExtension,
];

/** The list at the foot of the note, or '' when nothing was referenced. */
export function renderFootnotes(
  state: FootnoteState,
  renderBlocks: (tokens: Token[]) => string,
): string {
  // Rendering a note can itself reference another, which appends to the list.
  const items: string[] = [];
  for (let index = 0; index < state.referenced.length; index += 1) {
    const id = state.referenced[index]!;
    const number = index + 1;
    const backlink = `<a href="#fnref-${id}" class="footnote-backref" role="doc-backlink" aria-label="Back to reference ${number}">↩︎</a>`;
    const body = renderBlocks(state.definitions.get(id)!.blocks).trimEnd();
    items.push(
      `<li id="fn-${id}" role="doc-endnote">${
        body.endsWith('</p>')
          ? `${body.slice(0, -4)} ${backlink}</p>`
          : `${body} ${backlink}`
      }</li>`,
    );
  }
  if (!items.length) return '';
  return `<section class="footnotes" role="doc-endnotes" aria-label="Footnotes"><p class="footnotes__title" aria-hidden="true">Footnotes</p><ol>${items.join('')}</ol></section>\n`;
}
