import { describe, expect, it } from 'vitest';
import { noteDataSchema } from '../src/lib/content/schemas';
import { isNoteIcon } from '../src/lib/content/noteIcon';
import { samsungEmojiUrl } from '../src/lib/content/samsungEmoji';
import { toDetail } from '../src/lib/server/content/documents';
import { NOTES_COLLECTION } from '../src/lib/server/content/registry';
import { serializeContentDocument } from '../src/lib/server/content/serializers';

const image = '/images/notes/example/icon-123.png';

describe('file icons', () => {
  it('resolves Samsung artwork for complete emoji sequences and presentation variants', () => {
    for (const [emoji, filename] of [
      ['🌱', '1f331'],
      ['👩🏽‍💻', '1f469-1f3fd-200d-1f4bb'],
      ['🇺🇿', '1f1fa-1f1ff'],
      ['1️⃣', '0031-fe0f-20e3'],
      ['1⃣', '0031-fe0f-20e3'],
      ['❤', '2764-fe0f'],
      ['❤️', '2764-fe0f'],
    ]) {
      expect(samsungEmojiUrl(emoji!)).toMatch(
        new RegExp(`/png/112/${filename}\\.png$`),
      );
    }
    for (const unsupported of ['', 'hello', '🌱🌱', image]) {
      expect(samsungEmojiUrl(unsupported)).toBeUndefined();
    }
  });

  it('round trips emojis and uploaded images through stored metadata and list details', () => {
    for (const icon of ['🌱', '👩🏽‍💻', '🇺🇿', '1️⃣', image]) {
      const fields = noteDataSchema.parse({ icon });
      const detail = toDetail(NOTES_COLLECTION, {
        path: 'src/content/notes/example.md',
        content: serializeContentDocument(fields, '# Example'),
        encoding: 'utf8',
        byteLength: 0,
        updatedAt: '',
        revision: 'r1',
      });
      expect(detail.icon).toBe(icon);
      expect(detail.fields.icon).toBe(icon);
    }
    expect(noteDataSchema.parse({}).icon).toBeUndefined();
  });

  it('rejects text, multiple emojis and non-upload image sources', () => {
    for (const icon of [
      '',
      'hello',
      '1',
      '🌱🌱',
      'https://example.com/icon.png',
      '//example.com/icon.png',
      'javascript:alert(1)',
      '/images/notes/../icon.png',
      '/images/notes/icon.svg',
    ]) {
      expect(isNoteIcon(icon)).toBe(false);
      expect(noteDataSchema.safeParse({ icon }).success).toBe(false);
    }
  });
});
