import YAML from 'yaml';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedContentDocument {
  fields: Record<string, unknown>;
  body: string;
}

export function parseContentDocument(content: string): ParsedContentDocument {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return { fields: {}, body: content };

  const body = (match[2] ?? '').replace(/^\r?\n/, '');
  // Malformed frontmatter (a hand-edited note re-imported via notes:migrate,
  // say) must not throw: one bad note would otherwise 500 every page built from
  // the shared garden index, and lock Studio out of opening it to repair it.
  // Degrade to empty fields — the body still renders and the note stays editable.
  let fields: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    fields = {};
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
