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

/** `code` as escaped HTML with token spans; plain escaped text if unhighlighted. */
export function highlightToHtml(
  code: string,
  info: string | null | undefined,
): string {
  let html = '';
  let cursor = 0;
  for (const { from, to, kind } of tokenizeCode(code, info)) {
    html += escapeHtml(code.slice(cursor, from));
    html += `<span class="${tokenClass(kind)}">${escapeHtml(code.slice(from, to))}</span>`;
    cursor = to;
  }
  return html + escapeHtml(code.slice(cursor));
}
