import { describe, expect, it } from 'vitest';
import { youtubeEmbedUrl, youtubeMarkup } from '../src/lib/garden/youtube';
import { renderNote } from '../src/lib/garden/render';

describe('YouTube embeds', () => {
  it('normalizes supported video URLs and preserves timestamps', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXc&si=tracking',
      'https://youtu.be/dQw4w9WgXc',
      'https://youtube.com/shorts/dQw4w9WgXc',
      'https://m.youtube.com/live/dQw4w9WgXc',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXc',
    ])
      expect(youtubeEmbedUrl(url)).toBe(
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXc',
      );
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXc?t=1m30s')).toContain(
      '?start=90',
    );
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXc?t=90')).toContain(
      '?start=90',
    );
  });
  it('rejects arbitrary hosts, protocols, credentials and invalid IDs', () => {
    for (const value of [
      'javascript:alert(1)',
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXc',
      'https://evil.test/dQw4w9WgXc',
      'https://user@youtube.com/watch?v=dQw4w9WgXc',
      'https://youtube.com/playlist?list=abc',
      'https://youtu.be/invalid',
    ]) {
      expect(youtubeEmbedUrl(value)).toBeNull();
      expect(youtubeMarkup(value)).toBe('');
    }
  });
  it('renders the same responsive iframe on the public page', () => {
    const markup = youtubeMarkup('https://youtu.be/dQw4w9WgXc');
    const html = renderNote(markup).html;
    expect(html).toContain('class="note-youtube"');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXc');
    expect(html).toContain('allowfullscreen');
  });
});
