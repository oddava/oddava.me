import { describe, expect, it } from 'vitest';
import { noteDataSchema } from '../src/lib/content/schemas';
import { isNoteIcon } from '../src/lib/content/noteIcon';
import { toDetail } from '../src/lib/server/content/documents';
import { NOTES_COLLECTION } from '../src/lib/server/content/registry';
import { serializeContentDocument } from '../src/lib/server/content/serializers';

const image = '/images/notes/example/icon-123.png';

describe('file icons', () => {
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
