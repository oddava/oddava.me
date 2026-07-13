import YAML from 'yaml';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedContentDocument {
  fields: Record<string, unknown>;
  body: string;
}

export function parseContentDocument(content: string): ParsedContentDocument {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return { fields: {}, body: content };

  return {
    fields: (YAML.parse(match[1]) ?? {}) as Record<string, unknown>,
    body: (match[2] ?? '').replace(/^\r?\n/, ''),
  };
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
