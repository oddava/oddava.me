import type { Project } from './contracts';
import type { GardenDocument } from './garden/types';

/** How many projects and notes the home page shows below the hero. */
export const HOME_PROJECT_LIMIT = 3;
export const HOME_NOTE_LIMIT = 3;

/**
 * The projects home leads with: the ones marked featured, in list order. A
 * list with none marked (every list saved before the field existed) still
 * gets a section, from the top of its curated order.
 */
export function pickHomeProjects(
  projects: readonly Project[],
  limit = HOME_PROJECT_LIMIT,
): Project[] {
  const visible = projects.filter((project) => !project.hidden);
  const featured = visible.filter((project) => project.featured);
  return (featured.length > 0 ? featured : visible).slice(0, limit);
}

export interface HomeNote {
  href: string;
  title: string;
  /** `YYYY-MM-DD`, or `''` when the note carries no readable date. */
  date: string;
}

function dateKey(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

/**
 * The most recently updated notes, newest first. Only leaves count: the root
 * note is the notes page itself, and a note with notes under it is a folder's
 * hub, which an edit to any child would otherwise keep on top.
 */
export function pickLatestNotes(
  documents: readonly GardenDocument[],
  rootId: string,
  limit = HOME_NOTE_LIMIT,
): HomeNote[] {
  return documents
    .filter(
      (document) => document.id !== rootId && document.childIds.length === 0,
    )
    .map((document) => ({
      href: document.href,
      title: document.title,
      date: dateKey(document.updated),
    }))
    .toSorted((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}
