import { marked, type Tokens } from 'marked';
import { slugifyHeading } from '../../components/mdx/headings';
import { gardenSlug } from './utils';

// Runtime Markdown -> HTML for garden notes.
//
// When notes lived in the content collection, Astro compiled the MDX at build
// time and `remarkGardenLinks` + the custom heading components produced the
// final HTML. Notes now live in Redis and render at request time, so we
// reproduce that exact output with `marked`:
//   - `[[wiki links]]` become `<a class="wiki-link" data-wiki-target=...>`,
//     matching `remark-wiki-links.mjs`.
//   - h2–h4 gain a slug id, `tabindex="-1"`, and a trailing `#` anchor,
//     matching `Heading.astro`.
// The bodies are plain Markdown (no embedded components), so this is faithful.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

interface WikiLinkToken {
  type: 'wikiLink';
  raw: string;
  target: string;
  label: string;
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
    const wiki = token as unknown as WikiLinkToken;
    const slug = gardenSlug(wiki.target);
    return `<a class="wiki-link" data-wiki-target="${escapeAttr(
      wiki.target,
    )}" href="/notes/${slug}">${escapeHtml(wiki.label)}</a>`;
  },
};

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  marked.use({
    gfm: true,
    breaks: false,
    extensions: [wikiLinkExtension],
    renderer: {
      heading(
        this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } },
        token: Tokens.Heading,
      ) {
        const text = this.parser.parseInline(token.tokens);
        const depth = token.depth;
        if (depth >= 2 && depth <= 4) {
          const slug = slugifyHeading(text);
          return `<h${depth} id="${slug}" tabindex="-1">${text}<a href="#${slug}" class="anchor" aria-hidden="true">#</a></h${depth}>\n`;
        }
        return `<h${depth}>${text}</h${depth}>\n`;
      },
    },
  });
  configured = true;
}

export function renderNoteHtml(body: string): string {
  ensureConfigured();
  return marked.parse(body, { async: false }) as string;
}
