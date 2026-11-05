import { describe, expect, it } from 'vitest';
import type { Project } from '../src/lib/contracts';
import type { GardenDocument } from '../src/lib/garden/types';
import { pickHomeProjects, pickNoteShelves } from '../src/lib/home';

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  description: '',
  year: 2026,
  stack: [],
  hidden: false,
  ...extra,
});

const note = (
  path: string,
  updated: string,
  childIds: string[] = [],
): GardenDocument =>
  ({
    id: path,
    path,
    href: `/notes/${path}`,
    title: path.toUpperCase(),
    summary: `about ${path} `,
    updated,
    childIds,
  }) as never;

const root = { id: 'index', href: '/notes' };

describe('pickHomeProjects', () => {
  it('leads with featured projects in list order', () => {
    const picked = pickHomeProjects([
      project('a'),
      project('b', { featured: true }),
      project('c'),
      project('d', { featured: true }),
    ]);
    expect(picked.map((p) => p.id)).toEqual(['b', 'd']);
  });

  it('falls back to the top of the list when none are featured', () => {
    const picked = pickHomeProjects(
      ['a', 'b', 'c', 'd'].map((id) => project(id)),
    );
    expect(picked.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('never shows a hidden project, featured or not', () => {
    const picked = pickHomeProjects([
      project('a', { featured: true, hidden: true }),
      project('b'),
    ]);
    expect(picked.map((p) => p.id)).toEqual(['b']);
  });

  it('caps the featured set and handles an empty list', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) =>
      project(id, { featured: true }),
    );
    expect(pickHomeProjects(many)).toHaveLength(3);
    expect(pickHomeProjects([])).toEqual([]);
  });
});

describe('pickNoteShelves', () => {
  const garden = [
    note('index', '2026-11-05', ['diary', 'reading']),
    note('diary', '2026-11-04', ['diary/a', 'diary/b']),
    note('diary/a', '2026-10-01'),
    note('diary/b', '2026-10-20T08:00:00.000Z'),
    note('reading', '2026-11-05', ['reading/books']),
    note('reading/books', '2026-11-05', ['reading/books/sleep']),
    note('reading/books/sleep', '2026-07-11'),
    note('knowledge', '2026-01-01', ['knowledge/backend']),
    note('knowledge/backend', '2026-10-02'),
    note('loose', '2026-03-03'),
  ];

  it('gives each top folder its newest note, freshest folder first', () => {
    expect(pickNoteShelves(garden, root)).toEqual([
      {
        topic: 'diary',
        href: '/notes/diary',
        latest: {
          href: '/notes/diary/b',
          title: 'DIARY/B',
          summary: 'about diary/b',
          date: '2026-10-20',
        },
        more: 1,
      },
      {
        topic: 'knowledge',
        href: '/notes/knowledge',
        latest: expect.objectContaining({ href: '/notes/knowledge/backend' }),
        more: 0,
      },
      {
        topic: 'reading',
        href: '/notes/reading',
        latest: expect.objectContaining({ href: '/notes/reading/books/sleep' }),
        more: 0,
      },
    ]);
  });

  it('never lets a hub stand in for a note, however fresh', () => {
    const titles = pickNoteShelves(garden, root, 10).map((s) => s.latest.title);
    expect(titles).not.toContain('READING/BOOKS');
    expect(titles).not.toContain('INDEX');
  });

  it('shelves top-level notes together under the garden root', () => {
    const loose = pickNoteShelves(garden, root, 10).at(-1);
    expect(loose).toMatchObject({ topic: 'notes', href: '/notes', more: 0 });
    expect(loose?.latest.title).toBe('LOOSE');
  });

  it('is empty for a garden holding only its root', () => {
    expect(pickNoteShelves([note('index', '2026-01-01')], root)).toEqual([]);
  });
});
