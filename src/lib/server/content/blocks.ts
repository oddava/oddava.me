import type { ContentBlock, ContentBlockType } from './types';

function blockId(index: number): string {
  return `block-${index + 1}`;
}

function hasMdxSyntax(value: string): boolean {
  return /^(import|export)\s/m.test(value) || /^\s*[<{]/m.test(value);
}

function parseCodeBlock(value: string, index: number): ContentBlock | null {
  const match = value.match(/^```([a-z0-9_-]*)\r?\n([\s\S]*?)\r?\n```$/i);
  if (!match) return null;

  return {
    id: blockId(index),
    type: 'code',
    language: match[1] || '',
    value: match[2] ?? '',
  };
}

function parseImageBlock(value: string, index: number): ContentBlock | null {
  const match = value.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (!match) return null;

  return {
    id: blockId(index),
    type: 'image',
    alt: match[1] ?? '',
    src: match[2] ?? '',
  };
}

function parseHeadingBlock(value: string, index: number): ContentBlock | null {
  const match = value.match(/^(#{1,3})\s+(.+)$/);
  if (!match) return null;

  return {
    id: blockId(index),
    type: 'heading',
    level: match[1]!.length as 1 | 2 | 3,
    value: match[2] ?? '',
  };
}

function parseCalloutBlock(value: string, index: number): ContentBlock | null {
  if (!value.startsWith('>')) return null;

  const lines = value.split(/\r?\n/).map((line) => line.replace(/^>\s?/, ''));
  const titleMatch = lines[0]?.match(/^\[!([A-Z]+)\]\s*(.*)$/);

  return {
    id: blockId(index),
    type: 'callout',
    title: titleMatch ? titleMatch[2] || titleMatch[1] : 'Note',
    value: titleMatch ? lines.slice(1).join('\n').trim() : lines.join('\n'),
  };
}

export function bodyToBlocks(body: string): ContentBlock[] {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  return normalized.split(/\n{2,}/).map((chunk, index) => {
    const value = chunk.trim();
    const parsed =
      parseCodeBlock(value, index) ??
      parseImageBlock(value, index) ??
      parseHeadingBlock(value, index) ??
      parseCalloutBlock(value, index);

    if (parsed) return parsed;

    return {
      id: blockId(index),
      type: hasMdxSyntax(value) ? 'raw-mdx' : 'paragraph',
      value,
    };
  });
}

export function blocksToBody(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const level = Math.min(Math.max(block.level ?? 2, 1), 3);
        return `${'#'.repeat(level)} ${block.value ?? ''}`.trimEnd();
      }

      if (block.type === 'image') {
        return `![${block.alt ?? ''}](${block.src ?? ''})`;
      }

      if (block.type === 'code') {
        return `\`\`\`${block.language ?? ''}\n${block.value ?? ''}\n\`\`\``;
      }

      if (block.type === 'callout') {
        const title = block.title?.trim() || 'Note';
        const content = (block.value ?? '')
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join('\n');
        return [`> [!NOTE] ${title}`, content].filter(Boolean).join('\n');
      }

      return block.value ?? '';
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function createEmptyBlock(type: ContentBlockType): ContentBlock {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `block-${Date.now().toString(36)}`;

  if (type === 'heading') return { id, type, level: 2, value: '' };
  if (type === 'image') return { id, type, src: '', alt: '' };
  if (type === 'code') return { id, type, language: '', value: '' };
  if (type === 'callout') return { id, type, title: 'Note', value: '' };
  return { id, type, value: '' };
}
