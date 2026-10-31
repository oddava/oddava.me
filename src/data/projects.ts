export interface Project {
  name: string;
  /** One sentence, in the site's lowercase voice. */
  description: string;
  /** Year it started, or `now` for ongoing day-job work. */
  year: number | 'now';
  stack?: readonly string[];
  site?: string;
  source?: string;
}

// Ordered as shown: current work first, then newest to oldest.
export const projects: readonly Project[] = [
  {
    name: 'Ishbay',
    description: 'payroll management for businesses. my day job.',
    year: 'now',
    site: 'https://ishbay.com',
  },
  {
    name: 'oddava.me',
    description:
      'this site. notes live in redis and go public the moment studio autosaves, no deploy in between.',
    year: 2026,
    stack: ['astro', 'preact', 'redis', 'workers'],
    source: 'https://github.com/oddava/oddava.me',
  },
  {
    name: 'oddava notes',
    description:
      'an obsidian plugin that publishes notes from my vault to this site and pulls edits back, phone included.',
    year: 2026,
    stack: ['typescript', 'obsidian'],
    source: 'https://github.com/oddava/obsidian-oddava-notes',
  },
  {
    name: 'AniShows',
    description:
      'an anime tracker with reviews, forums, and a catalog synced from AniList.',
    year: 2025,
    stack: ['django', 'react', 'postgres', 'celery'],
    source: 'https://github.com/oddava/aniShows',
  },
];
