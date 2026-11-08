import { describe, expect, it } from 'vitest';
import type { Project } from '../src/lib/contracts';
import type { GardenDocument } from '../src/lib/garden/types';
import { pickHomeProjects, pickRecentNotes } from '../src/lib/home';

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

describe('pickRecentNotes', () => {
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

  it('lists the newest notes first, each with its topic and day', () => {
    expect(pickRecentNotes(garden, root)).toEqual([
      {
        href: '/notes/diary/b',
        title: 'DIARY/B',
        topic: 'diary',
        date: '2026-10-20',
      },
      expect.objectContaining({ href: '/notes/knowledge/backend' }),
      expect.objectContaining({ href: '/notes/diary/a' }),
      expect.objectContaining({ topic: 'reading', date: '2026-07-11' }),
      expect.objectContaining({ href: '/notes/loose', topic: '' }),
    ]);
  });

  it('never lets a hub or the root stand in for a note, however fresh', () => {
    const titles = pickRecentNotes(garden, root, 10).map((n) => n.title);
    expect(titles).not.toContain('READING/BOOKS');
    expect(titles).not.toContain('INDEX');
    expect(titles).toHaveLength(5);
  });

  it('caps the list', () => {
    expect(pickRecentNotes(garden, root, 2)).toHaveLength(2);
  });

  it('is empty for a garden holding only its root', () => {
    expect(pickRecentNotes([note('index', '2026-01-01')], root)).toEqual([]);
  });
});
