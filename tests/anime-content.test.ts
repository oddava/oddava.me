import { describe, expect, it } from 'vitest';
import { toAnimeFavoriteCards } from '../src/lib/content/anime';

describe('anime content helpers', () => {
  it('maps raw favorite entries to display-ready cards', () => {
    expect(
      toAnimeFavoriteCards([
        {
          anime: {
            slug: '1',
            title: 'First show',
            cover_image: 'https://img.test/large.jpg',
            cover_image_small: 'https://img.test/small.jpg',
            url: 'https://anilist.co/anime/1',
          },
        },
        {
          anime: {
            slug: '2',
            title: 'Second show',
            cover_image: '',
            cover_image_small: 'https://img.test/second-small.jpg',
            url: '',
          },
        },
      ]),
    ).toEqual([
      {
        coverImage: 'https://img.test/large.jpg',
        href: 'https://anilist.co/anime/1',
        title: 'First show',
      },
      {
        coverImage: 'https://img.test/second-small.jpg',
        href: 'https://anilist.co/anime/2',
        title: 'Second show',
      },
    ]);
  });

  it('filters entries that cannot render a cover image', () => {
    expect(
      toAnimeFavoriteCards([
        {
          anime: {
            slug: 'missing-cover',
            title: 'Missing cover',
            cover_image: null,
            cover_image_small: null,
          },
        },
      ]),
    ).toEqual([]);
  });
});
