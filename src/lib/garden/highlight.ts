import { resolveCodeLanguage } from './code-languages';
import { GRAMMARS, type TokenKind } from './highlight-grammars';

// A small, dependency-free syntax highlighter. It emits CLASS names only
// (`tok-kw`, `tok-str`, …): the site's hashed CSP forbids inline styles — which
// is why Astro's Shiki integration is off — so colour lives in the stylesheet,
// where it can follow the site's own tokens. The same tokenizer paints the
// public page (HTML spans) and Studio's editor (ProseMirror decorations).

export interface CodeToken {
  from: number;
  to: number;
  kind: TokenKind;
}

/** Past this a block is shown plain: scanning must never stall a keystroke. */
const MAX_HIGHLIGHT_LENGTH = 30_000;

export function tokenClass(kind: TokenKind): string {
  return `tok-${kind}`;
}

/** Highlighted ranges of `code`, in order and never overlapping. */
export function tokenizeCode(
  code: string,
  info: string | null | undefined,
): CodeToken[] {
  const language = resolveCodeLanguage(info);
  const rules = language && GRAMMARS[language.id];
  if (!rules || code.length > MAX_HIGHLIGHT_LENGTH) return [];

  const tokens: CodeToken[] = [];
  let position = 0;
  while (position < code.length) {
    let length = 0;
    for (const { kind, pattern } of rules) {
      pattern.lastIndex = position;
      const match = pattern.exec(code);
      if (!match || match[0].length === 0) continue;
      length = match[0].length;
      if (kind) tokens.push({ from: position, to: position + length, kind });
      break;
    }
    position += length || 1;
  }
  return tokens;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Characters one render may highlight across all its code blocks. Each block
 * is linear and capped, but a note of many capped blocks is not: past this,
 * the remaining blocks render as plain escaped code.
 */
export const MAX_DOCUMENT_HIGHLIGHT_LENGTH = 120_000;

/** What is left of one render's highlighting allowance. */
export interface HighlightBudget {
  remaining: number;
}

export function createHighlightBudget(
  limit = MAX_DOCUMENT_HIGHLIGHT_LENGTH,
): HighlightBudget {
  return { remaining: limit };
}

/**
 * `code` as escaped HTML with token spans; plain escaped text if unhighlighted.
 * With a `budget`, a block that does not fit what remains renders plain, and a
 * block that is highlighted spends its length.
 */
export function highlightToHtml(
  code: string,
  info: string | null | undefined,
  budget?: HighlightBudget,
): string {
  let tokens: CodeToken[] = [];
  if (!budget || code.length <= budget.remaining) {
    tokens = tokenizeCode(code, info);
    if (budget) budget.remaining -= code.length;
  }
  let html = '';
  let cursor = 0;
  for (const { from, to, kind } of tokens) {
    html += escapeHtml(code.slice(cursor, from));
    html += `<span class="${tokenClass(kind)}">${escapeHtml(code.slice(from, to))}</span>`;
    cursor = to;
  }
  return html + escapeHtml(code.slice(cursor));
}
