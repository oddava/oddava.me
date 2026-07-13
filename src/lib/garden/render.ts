import { marked, Renderer, type Token, type Tokens } from 'marked';
import { slugifyHeading } from '../../components/mdx/headings';
import { normalizeWikiLinkTarget } from './utils';

// Runtime Markdown -> HTML for garden notes. The ONLY note renderer.
//
// Notes are committed MDX and their raw bodies render through this function.
// Both surfaces that display a note body call it:
//   - the published page (`GardenDocumentPage.astro`)
//   - the Studio preview pane (`ContentWorkspace.tsx`)
// so the preview cannot drift from the page — it is the page. The matching CSS
// lives in one file too: `src/styles/components/_note-prose.css`, loaded by
// both. If you change how notes render, change it here; there is nowhere else.
//
// The output shape (kept from the retired MDX build):
//   - `[[wiki links]]` become `<a class="wiki-link" data-wiki-target=...>`
//   - h2–h4 gain a slug id, `tabindex="-1"`, and a trailing `#` anchor

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

interface WikiLinkToken extends Tokens.Generic {
  type: 'wikiLink';
  raw: string;
  target: string;
  label: string;
  href?: string;
}

function isWikiLinkToken(token: Token): token is WikiLinkToken {
  return (
    token.type === 'wikiLink' &&
    typeof token.target === 'string' &&
    typeof token.label === 'string'
  );
}

const wikiLinkExtension = {
  name: 'wikiLink',
  level: 'inline' as const,
  start(src: string) {
    const index = src.indexOf('[[');
    return index < 0 ? undefined : index;
  },
  tokenizer(src: string): WikiLinkToken | undefined {
    const match = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!match) return undefined;
    const target = match[1]!.trim();
    return {
      type: 'wikiLink',
      raw: match[0],
      target,
      label: (match[2] ?? match[1])!.trim(),
    };
  },
  renderer(token: Tokens.Generic) {
    if (!isWikiLinkToken(token)) return false;
    const href =
      token.href ?? `/notes/${normalizeWikiLinkTarget(token.target)}`;
    return `<a class="wiki-link" data-wiki-target="${escapeAttr(
      token.target,
    )}" href="${escapeAttr(href)}">${escapeHtml(token.label)}</a>`;
  },
};

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  marked.use({
    gfm: true,
    // Obsidian's reading view, not CommonMark: a single newline is a line
    // break. Notes are written as lines that are meant to stay lines —
    // metadata rows, lists of one-liners — so a newline means what it looks
    // like. Blank line still starts a new paragraph.
    breaks: true,
    extensions: [wikiLinkExtension],
  });
  configured = true;
}

function createRenderer(): Renderer {
  const renderer = new Renderer();
  const slugCounts = new Map<string, number>();

  renderer.heading = function heading(token: Tokens.Heading): string {
    const text = this.parser.parseInline(token.tokens);
    const depth = token.depth;
    if (depth >= 2 && depth <= 4) {
      const baseSlug = slugifyHeading(text);
      const occurrence = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, occurrence + 1);
      const slug = occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence}`;
      return `<h${depth} id="${slug}" tabindex="-1">${text}<a href="#${slug}" class="anchor" aria-hidden="true">#</a></h${depth}>\n`;
    }
    return `<h${depth}>${text}</h${depth}>\n`;
  };

  return renderer;
}

export interface RenderNoteOptions {
  wikiLinkHrefs?: ReadonlyMap<string, string>;
}

export function renderNoteHtml(
  body: string,
  options: RenderNoteOptions = {},
): string {
  ensureConfigured();
  return marked.parse(body, {
    async: false,
    renderer: createRenderer(),
    walkTokens(token) {
      if (!isWikiLinkToken(token)) return;
      token.href = options.wikiLinkHrefs?.get(
        normalizeWikiLinkTarget(token.target),
      );
    },
  }) as string;
}
