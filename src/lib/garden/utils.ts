export type NoteTagSource = {
  body: string;
};

const TAG_PATTERN = /(^|\s)#([a-zA-Z0-9][a-zA-Z0-9_/-]*)/g;
const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/m;

export function gardenSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['\u0022]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeWikiLinkTarget(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map(gardenSlug)
    .filter(Boolean)
    .join('/');
}

export interface WikiLinkReference {
  id: string;
  title: string;
  href: string;
}

/**
 * Resolves exact note paths first, then unique title/leaf aliases. Ambiguous
 * shorthand is omitted instead of linking to whichever note happened to load
 * last.
 */
export function buildWikiLinkHrefLookup(
  references: readonly WikiLinkReference[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  const aliases = new Map<string, Set<string>>();

  for (const reference of references) {
    const id = normalizeWikiLinkTarget(reference.id);
    if (id) lookup.set(id, reference.href);

    const leaf = reference.id.split('/').filter(Boolean).at(-1) ?? '';
    for (const value of [reference.title, leaf]) {
      const alias = normalizeWikiLinkTarget(value);
      if (!alias) continue;
      const hrefs = aliases.get(alias) ?? new Set<string>();
      hrefs.add(reference.href);
      aliases.set(alias, hrefs);
    }
  }

  for (const [alias, hrefs] of aliases) {
    if (lookup.has(alias) || hrefs.size !== 1) continue;
    lookup.set(alias, hrefs.values().next().value!);
  }

  return lookup;
}

export function noteIdFromSourceId(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value;
}

export function notePathFromSourceId(value: string): string {
  const path = value
    .replace(/\\/g, '/')
    // Both, while the live store still holds `.mdx` keys alongside new `.md`.
    .replace(/\.mdx?$/i, '')
    .split('/')
    .filter(Boolean)
    .join('/');

  return path === 'index' ? '' : path;
}

export function noteHrefFromSourceId(value: string): string {
  const path = notePathFromSourceId(value);
  return path ? `/notes/${path}` : '/notes';
}

export function noteParentIdFromSourceId(value: string): string | null {
  const path = notePathFromSourceId(value);
  if (!path) return null;

  const segments = path.split('/');
  segments.pop();
  return segments.length > 0 ? segments.join('/') : 'index';
}

export function noteFolderFromSourceId(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

/**
 * Builds compatibility redirects only for globally unique leaf names. A
 * legacy bare slug cannot safely choose between two notes in different
 * folders, so ambiguous aliases are deliberately omitted.
 */
export function uniqueNoteLeafRedirects(
  sources: readonly { id: string }[],
): Array<{ slug: string; redirectTo: string }> {
  const bySlug = new Map<string, string | null>();

  for (const source of sources) {
    const slug = noteIdFromSourceId(source.id);
    if (slug === 'index') continue;
    bySlug.set(slug, bySlug.has(slug) ? null : noteHrefFromSourceId(source.id));
  }

  return [...bySlug].flatMap(([slug, redirectTo]) =>
    redirectTo ? [{ slug, redirectTo }] : [],
  );
}

export function folderTitle(value: string): string {
  const name = value.split('/').filter(Boolean).pop() ?? value;
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractInlineTags(body: string): string[] {
  return [...body.matchAll(TAG_PATTERN)].map((match) =>
    match[2]!.toLowerCase(),
  );
}

export function getNoteTags(note: NoteTagSource): string[] {
  return [
    ...new Set(
      extractInlineTags(note.body).map((tag) =>
        tag.replace(/^#/, '').trim().toLowerCase(),
      ),
    ),
  ]
    .filter(Boolean)
    .toSorted();
}

// Strip inline markdown so a heading or paragraph reads as plain text when it
// stands in for a title or meta description.
function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[[^\]|\n]+\|([^\]\n]+)\]\]/g, '$1')
    .replace(/\[\[([^\]|\n]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The title emerges from the content: the first heading you write, else the
// humanized file name. No separate title field to keep in sync.
export function deriveTitle(body: string, id: string): string {
  const heading = body.match(HEADING_PATTERN)?.[1];
  if (heading) {
    const text = stripInlineMarkdown(heading);
    if (text) return text;
  }
  return folderTitle(id);
}

// The first real paragraph doubles as the meta description / search preview.
export function deriveSummary(body: string): string {
  for (const block of body.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line || line.startsWith('#') || line.startsWith('![')) continue;
    const text = stripInlineMarkdown(line.replace(/^>\s?/gm, ''));
    if (text) return text;
  }
  return '';
}
