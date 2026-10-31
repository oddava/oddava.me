import type { Project } from '../../contracts';

/**
 * What /projects shows until the first admin save. The store holds no list
 * until then, so a fresh environment (or production right after this shipped)
 * still has a page; the first save writes the whole list and this stops
 * mattering.
 */
export const DEFAULT_PROJECTS: readonly Project[] = [
  {
    id: 'ishbay',
    name: 'Ishbay',
    description: 'payroll management for businesses. my day job.',
    year: 'now',
    stack: [],
    site: 'https://ishbay.com',
    hidden: false,
  },
  {
    id: 'oddava-me',
    name: 'oddava.me',
    description:
      'this site. notes live in redis and go public the moment studio autosaves, no deploy in between.',
    year: 2026,
    stack: ['astro', 'preact', 'redis', 'workers'],
    source: 'https://github.com/oddava/oddava.me',
    hidden: false,
  },
  {
    id: 'oddava-notes',
    name: 'oddava notes',
    description:
      'an obsidian plugin that publishes notes from my vault to this site and pulls edits back, phone included.',
    year: 2026,
    stack: ['typescript', 'obsidian'],
    source: 'https://github.com/oddava/obsidian-oddava-notes',
    hidden: false,
  },
  {
    id: 'anishows',
    name: 'AniShows',
    description:
      'an anime tracker with reviews, forums, and a catalog synced from AniList.',
    year: 2025,
    stack: ['django', 'react', 'postgres', 'celery'],
    source: 'https://github.com/oddava/aniShows',
    hidden: false,
  },
];
