import { marked, Renderer, type Token, type Tokens } from 'marked';
import { slugifyHeading } from '../../components/mdx/headings';
import { normalizeWikiLinkTarget } from './utils';

// Runtime Markdown -> HTML for garden notes. The ONLY note renderer.
//
// Notes are plain Markdown read from the Redis content store — nothing ever
// used MDX — and their raw bodies render through this function.
// Both surfaces that display a note body call it:
//   - the published page (`GardenDocumentPage.astro`)
//   - the Studio preview pane (`ContentWorkspace.tsx`)
// so the preview cannot drift from the page — it is the page. The matching CSS
// lives in one file too: `src/styles/components/_note-prose.css`, loaded by
// both. If you change how notes render, change it here; there is nowhere else.
//
// The output shape (kept from the retired MDX build):
//   - resolved `[[wiki links]]` become `<a class="wiki-link" data-wiki-target=...>`;
//     unresolved ones an inert `<span class="wiki-link wiki-link--broken">`
//   - inline `#tags` become `<a class="note-tag">` pointing at their tag page
//   - external http(s) links gain `class="external-link"` and rel hygiene
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
    // A wiki link with no resolved note is a wish, not a destination: render
    // it as an inert span instead of guessing a path that would 404.
    if (!token.href) {
      return `<span class="wiki-link wiki-link--broken" title="this note doesn't exist yet">${escapeHtml(
        token.label,
      )}</span>`;
    }
    return `<a class="wiki-link" data-wiki-target="${escapeAttr(
      token.target,
    )}" href="${escapeAttr(token.href)}">${escapeHtml(token.label)}</a>`;
  },
};

interface NoteTagToken extends Tokens.Generic {
  type: 'noteTag';
  raw: string;
  tag: string;
}

function isNoteTagToken(token: Token): token is NoteTagToken {
  return token.type === 'noteTag' && typeof token.tag === 'string';
}

// Inline #tags link to their tag pages. The pattern mirrors `TAG_PATTERN` in
// utils.ts — the tag vocabulary IS the set of inline hashtags — including its
// boundary rule: a tag starts the input or follows whitespace, so `issue#5`
// stays plain text. Code spans and fenced blocks are consumed before inline
// extensions ever see them, and headings strip their `#` at the block level.
const noteTagExtension = {
  name: 'noteTag',
  level: 'inline' as const,
  start(src: string) {
    const index = src.indexOf('#');
    return index < 0 ? undefined : index;
  },
  tokenizer(src: string, tokens: Token[]): NoteTagToken | undefined {
    const match = /^#([a-zA-Z0-9][a-zA-Z0-9_/-]*)/.exec(src);
    if (!match) return undefined;
    // The lexer hands us the tokens emitted so far in this inline run; the
    // character before this `#` is the tail of the last token's raw text. No
    // previous token means the run starts here, which is a boundary too.
    const previous = tokens.at(-1)?.raw;
    if (previous !== undefined && !/\s$/.test(previous)) return undefined;
    return { type: 'noteTag', raw: match[0], tag: match[1]! };
  },
  renderer(token: Tokens.Generic) {
    if (!isNoteTagToken(token)) return false;
    const tag = token.tag.toLowerCase();
    return `<a class="note-tag" href="/notes/tag/${escapeAttr(tag)}">#${escapeHtml(tag)}</a>`;
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
    extensions: [wikiLinkExtension, noteTagExtension],
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

  // Outbound http(s) links get a class for the outward affordance and the
  // usual rel hygiene — same tab, no target. Internal, mailto:, and other
  // schemes render exactly as marked would.
  renderer.link = function link(token: Tokens.Link): string {
    const html = Renderer.prototype.link.call(this, token);
    if (!/^https?:\/\//i.test(token.href)) return html;
    return html.replace(
      /^<a /,
      '<a class="external-link" rel="noopener noreferrer" ',
    );
  };

  // Image alt text must be plain text: inline extensions (tags, wiki links)
  // still parse inside the description, but the resulting HTML is stripped
  // back to text before it reaches the alt attribute.
  renderer.image = function image(token: Tokens.Image): string {
    const alt = this.parser.parseInline(token.tokens).replace(/<[^>]+>/g, '');
    let html = `<img src="${escapeAttr(token.href)}" alt="${escapeAttr(alt)}"`;
    if (token.title) {
      html += ` title="${escapeAttr(token.title)}"`;
    }
    return `${html}>`;
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
