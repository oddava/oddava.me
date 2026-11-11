import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Rubricated code: Shiki tokenises, and the note's own CSS colours. Keywords
// take the rubric, comments go italic in ink-3, and everything else is ink —
// so the theme below is not a palette at all. Its "colours" are sentinels that
// name a class; `renderHighlighted` turns each one back into `tok-<role>` and
// `_code.css` styles that fixed vocabulary. No inline style ever reaches the
// page, and no colour lives anywhere but the design tokens.
//
// This module is only ever loaded through `import()` (see `loadHighlighter` in
// render.ts): the Worker pays for it once per isolate, Studio only when a note
// has a fenced block, and public clients never.

/** Token roles, in the order their sentinels are numbered. */
export const TOKEN_ROLES = [
  'keyword',
  'comment',
  'string',
  'inserted',
  'deleted',
] as const;

export type TokenRole = (typeof TOKEN_ROLES)[number];

const FOREGROUND = '#000000';
const sentinel = (role: TokenRole) => `#00000${TOKEN_ROLES.indexOf(role) + 1}`;
const ROLE_BY_SENTINEL = new Map<string, TokenRole>(
  TOKEN_ROLES.map((role) => [sentinel(role), role]),
);

const RUBRIC_THEME = {
  name: 'rubric',
  type: 'light' as const,
  fg: FOREGROUND,
  bg: '#ffffff',
  settings: [
    { settings: { foreground: FOREGROUND } },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.logical.python',
        'markup.heading',
        'entity.name.tag',
        'support.type.property-name.css',
      ],
      settings: { foreground: sentinel('keyword') },
    },
    // Operators and punctuation are tokenised under `keyword.operator.*`;
    // they stay ink, or every `=` and `+` would be rubricated.
    {
      scope: [
        'keyword.operator',
        'keyword.operator.assignment',
        'keyword.operator.arithmetic',
        'keyword.operator.comparison',
        'keyword.operator.relational',
        'keyword.operator.logical',
        'keyword.operator.bitwise',
        'keyword.operator.ternary',
        'keyword.operator.optional',
        'keyword.operator.spread',
        'keyword.operator.type',
        'keyword.operator.definiteassignment',
      ],
      settings: { foreground: FOREGROUND },
    },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: sentinel('comment') },
    },
    {
      scope: ['string', 'punctuation.definition.string', 'string.regexp'],
      settings: { foreground: sentinel('string') },
    },
    {
      scope: ['markup.inserted', 'meta.diff.header.to-file'],
      settings: { foreground: sentinel('inserted') },
    },
    {
      scope: ['markup.deleted', 'meta.diff.header.from-file'],
      settings: { foreground: sentinel('deleted') },
    },
  ],
};

const LANGUAGES = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
} as const;

type LanguageName = keyof typeof LANGUAGES;

const ALIASES: Record<string, LanguageName> = {
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  // The tsx grammar reads JSX too; carrying both would double the bytes.
  jsx: 'tsx',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  md: 'markdown',
  yml: 'yaml',
  patch: 'diff',
  jsonc: 'json',
};

/** The grammar a fence's info string names, or null if we carry none. */
export function resolveLanguage(info: string | undefined): LanguageName | null {
  const name = info?.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!name) return null;
  if (name in LANGUAGES) return name as LanguageName;
  return ALIASES[name] ?? null;
}

export async function createRubricHighlighter(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [RUBRIC_THEME],
    langs: Object.values(LANGUAGES).map((load) => load()),
    engine: createJavaScriptRegexEngine(),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A fenced block as rubricated HTML, or null when the language is not one we
 * carry (the caller then falls back to marked's plain `pre > code`).
 */
export function renderHighlighted(
  highlighter: HighlighterCore,
  code: string,
  info: string | undefined,
): string | null {
  const lang = resolveLanguage(info);
  if (!lang) return null;
  let lines;
  try {
    lines = highlighter.codeToTokensBase(code, { lang, theme: 'rubric' });
  } catch {
    return null;
  }
  const body = lines
    .map((line) =>
      line
        .map((token) => {
          const text = escapeHtml(token.content);
          const role = token.color
            ? ROLE_BY_SENTINEL.get(token.color.toLowerCase())
            : undefined;
          return role ? `<span class="tok-${role}">${text}</span>` : text;
        })
        .join(''),
    )
    .join('\n');
  const label = escapeHtml(info!.trim().split(/\s+/, 1)[0]!.toLowerCase());
  // A scrollable region must be reachable by keyboard; the label names it.
  return `<pre class="code-block" data-language="${label}" tabindex="0"><code class="language-${label}">${body}\n</code></pre>\n`;
}
