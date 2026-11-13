import { describe, expect, it } from 'vitest';
import {
  NOTE_PREVIEW_PREFIX,
  noteEntryPath,
  notePreviewUrl,
} from '../src/lib/note-preview-url';
import { applySecurityHeaders } from '../src/lib/server/core/security-headers';

describe('note preview links', () => {
  it('point at the admin host, never the notes origin', () => {
    expect(NOTE_PREVIEW_PREFIX).toBe('/admin/preview');
    expect(notePreviewUrl('diary/secret')).toBe('/admin/preview/diary/secret');
    expect(notePreviewUrl('/diary/secret/')).toBe(
      '/admin/preview/diary/secret',
    );
    expect(notePreviewUrl('')).toBe('/admin/preview');
  });

  it('name a Studio entry by its collection path', () => {
    expect(noteEntryPath({ folder: 'diary', id: 'secret' })).toBe(
      'diary/secret',
    );
    expect(noteEntryPath({ folder: '', id: 'secret' })).toBe('secret');
    expect(noteEntryPath({ folder: '', id: 'index' })).toBe('');
  });

  it('keep the preview page private through the security middleware', () => {
    const page = applySecurityHeaders(
      new Response('<p>draft</p>', {
        headers: { 'Cache-Control': 'private, no-store' },
      }),
      'https://oddava.me/admin/preview/diary/secret',
    );
    expect(page.headers.get('Cache-Control')).toBe('private, no-store');

    // Any other admin page is still forced to no-store.
    const other = applySecurityHeaders(
      new Response('', { headers: { 'Cache-Control': 'public, max-age=60' } }),
      'https://oddava.me/admin/files',
    );
    expect(other.headers.get('Cache-Control')).toBe('no-store');
  });
});
