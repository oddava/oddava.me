import { describe, expect, it } from 'vitest';
import type { Project } from '../src/lib/contracts';
import type { GardenDocument } from '../src/lib/garden/types';
import { pickHomeProjects, pickLatestNotes } from '../src/lib/home';

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
  id: string,
  updated: string,
  childIds: string[] = [],
): GardenDocument =>
  ({
    id,
    href: `/notes/${id}`,
    title: id.toUpperCase(),
    updated,
    childIds,
  }) as never;

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

describe('pickLatestNotes', () => {
  it('lists the newest three, skipping the root note', () => {
    const picked = pickLatestNotes(
      [
        note('index', '2026-11-05'),
        note('old', '2025-01-01'),
        note('new', '2026-11-01T10:00:00.000Z'),
        note('mid', '2026-06-15'),
        note('older', '2024-03-03'),
      ],
      'index',
    );
    expect(picked).toEqual([
      { href: '/notes/new', title: 'NEW', date: '2026-11-01' },
      { href: '/notes/mid', title: 'MID', date: '2026-06-15' },
      { href: '/notes/old', title: 'OLD', date: '2025-01-01' },
    ]);
  });

  it('skips folder hubs, however recently a child moved them', () => {
    const picked = pickLatestNotes(
      [
        note('reading', '2026-11-05', ['reading/book']),
        note('reading/book', '2026-11-04'),
      ],
      'index',
    );
    expect(picked.map((n) => n.title)).toEqual(['READING/BOOK']);
  });

  it('sorts an undated note last with an empty date', () => {
    const picked = pickLatestNotes(
      [note('undated', 'not a date'), note('dated', '2026-01-02')],
      'index',
    );
    expect(picked.map((n) => [n.title, n.date])).toEqual([
      ['DATED', '2026-01-02'],
      ['UNDATED', ''],
    ]);
  });

  it('is empty for a garden holding only its root', () => {
    expect(pickLatestNotes([note('index', '2026-01-01')], 'index')).toEqual([]);
  });
});
