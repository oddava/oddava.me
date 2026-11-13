import YAML from 'yaml';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedContentDocument {
  fields: Record<string, unknown>;
  body: string;
  /**
   * Set when the note has a frontmatter block YAML cannot parse. Its fields
   * are then unknowable, so they read as `{ draft: true }`: see below.
   */
  frontmatterError?: true;
}

export function parseContentDocument(content: string): ParsedContentDocument {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return { fields: {}, body: content };

  const body = (match[2] ?? '').replace(/^\r?\n/, '');
  // Malformed frontmatter (a hand-edited note re-imported via notes:migrate,
  // say) must not throw: one bad note would otherwise 500 every page built from
  // the shared garden index, and lock Studio out of opening it to repair it.
  //
  // It must not degrade to empty fields either: absence of `draft` means
  // published, so `draft: true` next to one bad line would publish the note.
  // We cannot tell whether a broken block held `draft: true`, so it fails
  // closed — every unparseable block reads as a draft. The garden keeps the
  // note out of every public surface and Studio still lists it (as a draft)
  // so the owner can repair it; saving rewrites clean frontmatter that keeps
  // `draft: true` until the owner publishes on purpose.
  let fields: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    return { fields: { draft: true }, body, frontmatterError: true };
  }
  return { fields, body };
}

export function serializeContentDocument(
  fields: Record<string, unknown>,
  body: string,
): string {
  const definedFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const frontmatter = Object.keys(definedFields).length
    ? YAML.stringify(definedFields).trimEnd()
    : '';
  const normalizedBody = body.trimStart();

  if (!frontmatter) return normalizedBody;
  return `---\n${frontmatter}\n---\n\n${normalizedBody}`;
}
