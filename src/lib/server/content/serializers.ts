import YAML from 'yaml';
import type { ContentFormat } from './types';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedContentDocument {
  fields: Record<string, unknown>;
  body: string;
}

export function parseContentDocument(
  content: string,
  format: ContentFormat,
): ParsedContentDocument {
  if (format === 'yaml') {
    return {
      fields: (YAML.parse(content) ?? {}) as Record<string, unknown>,
      body: '',
    };
  }

  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return {
      fields: {},
      body: content,
    };
  }

  return {
    fields: (YAML.parse(match[1]) ?? {}) as Record<string, unknown>,
    body: (match[2] ?? '').replace(/^\r?\n/, ''),
  };
}

export function serializeContentDocument(
  fields: Record<string, unknown>,
  body: string,
  format: ContentFormat,
): string {
  const frontmatter = YAML.stringify(fields).trimEnd();

  if (format === 'yaml') {
    return `${frontmatter}\n`;
  }

  const normalizedBody = body.trimStart();
  return `---\n${frontmatter}\n---\n\n${normalizedBody}`;
}
