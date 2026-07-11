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

export function noteIdFromSourceId(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value;
}

export function notePathFromSourceId(value: string): string {
  const path = value
    .replace(/\\/g, '/')
    .replace(/\.mdx$/i, '')
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

export function folderTitle(value: string): string {
  const name = value.split('/').filter(Boolean).pop() ?? value;
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function extractInlineTags(body: string): string[] {
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
