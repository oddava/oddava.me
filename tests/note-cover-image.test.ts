import { describe, expect, it } from 'vitest';
import { isNoteImageUrl, noteDataSchema } from '../src/lib/content/schemas';
import { resolveNoteSocialImage } from '../src/lib/garden/utils';

describe('note cover image frontmatter', () => {
  it('accepts https URLs and site-relative paths only', () => {
    for (const good of [
      'https://cdn.example/cover.jpg',
      '/images/notes/cover.webp',
    ]) {
      expect(isNoteImageUrl(good)).toBe(true);
    }
    for (const bad of [
      'http://cdn.example/cover.jpg',
      '//evil.example/cover.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,abc',
      'cover.jpg',
      '/path with space.png',
      '/\\evil.example',
      ' https://cdn.example/a.png',
      '',
      42,
      null,
    ]) {
      expect(isNoteImageUrl(bad)).toBe(false);
    }
  });

  it('keeps valid image and image_alt and drops other unknown keys', () => {
    expect(
      noteDataSchema.parse({
        image: '/images/a.png',
        image_alt: 'A cover',
        tags: ['x'],
      }),
    ).toEqual({ image: '/images/a.png', image_alt: 'A cover' });
  });

  it('maps cover to image, preferring image when both are valid', () => {
    expect(noteDataSchema.parse({ cover: '/c.png' })).toEqual({
      image: '/c.png',
    });
    expect(noteDataSchema.parse({ image: '/i.png', cover: '/c.png' })).toEqual({
      image: '/i.png',
    });
    expect(
      noteDataSchema.parse({ image: 'javascript:x', cover: '/c.png' }),
    ).toEqual({ image: '/c.png' });
  });

  it('drops invalid values without failing the parse', () => {
    expect(
      noteDataSchema.parse({
        image: 'data:image/png;base64,abc',
        image_alt: 'x'.repeat(201),
        title: 'kept',
      }),
    ).toEqual({ title: 'kept' });
    expect(noteDataSchema.parse({ image: 5, image_alt: { a: 1 } })).toEqual({});
    expect(noteDataSchema.parse({ image_alt: 'x'.repeat(200) })).toEqual({
      image_alt: 'x'.repeat(200),
    });
  });

  it('prefers frontmatter over the body image, with the cover alias', () => {
    const body = '![Body alt](/images/body.png)';
    expect(resolveNoteSocialImage({ body })).toEqual({
      src: '/images/body.png',
      alt: 'Body alt',
    });
    const data = noteDataSchema.parse({ cover: '/images/fm.png' });
    expect(resolveNoteSocialImage({ body, data })).toEqual({
      src: '/images/fm.png',
    });
    expect(
      resolveNoteSocialImage({
        body,
        data: noteDataSchema.parse({ image: '/fm.png', image_alt: 'FM alt' }),
      }),
    ).toEqual({ src: '/fm.png', alt: 'FM alt' });
    // No image anywhere: the caller falls through to the generated card.
    expect(resolveNoteSocialImage({ body: '# plain', data: {} })).toBe(
      undefined,
    );
  });
});
