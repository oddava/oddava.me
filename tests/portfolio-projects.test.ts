import { describe, expect, it } from 'vitest';
import type { Project } from '../src/lib/contracts';
import { pickHomeProjects } from '../src/lib/home';
import {
  EXCLUDED_PROJECT_IDS,
  IMAGE_OVERRIDES,
  PREVIEW_UNAVAILABLE_IDS,
  presentProjects,
  projectHref,
} from '../src/lib/portfolio-projects';
import { DEFAULT_PROJECTS } from '../src/lib/server/projects/defaults';

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  description: `${id} description`,
  year: 2026,
  stack: [],
  hidden: false,
  ...extra,
});

const image = (name: string) => ({
  src: `/images/notes/projects/${name}.jpg`,
  alt: name,
});

// The store as it is published: the self entry is still in it, and AniShows
// has a stored cover.
const stored: Project[] = [
  project('minesweeper', { image: image('minesweeper'), site: 'https://m.x' }),
  project('ishbay', { image: image('ishbay'), site: 'https://ishbay.com' }),
  project('oddava-me', { image: image('self'), source: 'https://gh/self' }),
  project('anishows', { image: image('anishows'), source: 'https://gh/ani' }),
];

describe('portfolio project overrides', () => {
  it('keys on ids that exist in the checked-in defaults', () => {
    const known = new Set(DEFAULT_PROJECTS.map((entry) => entry.id));
    for (const id of [
      ...EXCLUDED_PROJECT_IDS,
      ...PREVIEW_UNAVAILABLE_IDS,
      ...Object.keys(IMAGE_OVERRIDES),
    ]) {
      expect(known.has(id)).toBe(true);
    }
  });

  it('drops the self entry before home picks its three', () => {
    const shown = pickHomeProjects(presentProjects(stored));
    expect(shown.map((entry) => entry.id)).toEqual([
      'minesweeper',
      'ishbay',
      'anishows',
    ]);
  });

  it('drops the self entry even when it is featured', () => {
    const featured = stored.map((entry) =>
      entry.id === 'oddava-me' || entry.id === 'ishbay'
        ? { ...entry, featured: true }
        : entry,
    );
    const shown = pickHomeProjects(presentProjects(featured));
    expect(shown.map((entry) => entry.id)).toEqual(['ishbay']);
  });

  it('keeps the stored order and the stored data', () => {
    const before = structuredClone(stored);
    const presented = presentProjects(stored);
    expect(presented.map((entry) => entry.id)).toEqual([
      'minesweeper',
      'ishbay',
      'anishows',
    ]);
    // Display-only: the input list (the store's data) is not touched.
    expect(stored).toEqual(before);
  });

  it('shows AniShows as unavailable without dropping its stored image', () => {
    const anishows = presentProjects(stored).find(
      (entry) => entry.id === 'anishows',
    );
    expect(anishows?.previewUnavailable).toBe(true);
    expect(anishows?.image).toBeUndefined();
    expect(stored[3].image).toEqual(image('anishows'));
  });

  it('uses the local redacted Ishbay picture', () => {
    const ishbay = presentProjects(stored).find(
      (entry) => entry.id === 'ishbay',
    );
    expect(ishbay?.image?.src).toBe(
      '/images/projects/ishbay-cover-redacted.jpg',
    );
    expect(ishbay?.previewUnavailable).toBe(false);
  });

  it('passes projects it does not name through as stored', () => {
    const future = [
      project('new-thing', {
        image: { ...image('new-thing'), x: 15, zoom: 1.4 },
        site: 'https://new.example',
        featured: true,
      }),
      project('no-picture', { source: 'https://gh/np' }),
    ];
    const [withImage, withoutImage] = presentProjects(future);
    expect(withImage).toEqual({ ...future[0], previewUnavailable: false });
    expect(withoutImage.previewUnavailable).toBe(true);
    expect(withoutImage.image).toBeUndefined();
  });

  it('links a project to its site, else its source, else nowhere', () => {
    expect(projectHref(project('a', { site: 'https://a', source: 'b' }))).toBe(
      'https://a',
    );
    expect(projectHref(project('b', { source: 'https://b' }))).toBe(
      'https://b',
    );
    expect(projectHref(project('c'))).toBeUndefined();
  });
});
