import type { Project } from './contracts';
import type { GardenDocument } from './garden/types';

/** How many projects and notes the home page shows below the hero. */
export const HOME_PROJECT_LIMIT = 3;
export const HOME_NOTE_LIMIT = 5;

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
  /** The top-level folder it sits in, e.g. `reading`; `''` at the top level. */
  topic: string;
  /** `YYYY-MM-DD`, or `''` when the note carries no readable date. */
  date: string;
}

function dateKey(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

/**
 * The garden's latest writing, newest first. Only leaves count — the root
 * note is the notes page itself, and a note with notes under it is a
 * folder's hub, which an edit to any child would otherwise keep on top.
 */
export function pickRecentNotes(
  documents: readonly GardenDocument[],
  root: Pick<GardenDocument, 'id'>,
  limit = HOME_NOTE_LIMIT,
): HomeNote[] {
  return documents
    .filter((doc) => doc.id !== root.id && doc.childIds.length === 0)
    .map((doc) => {
      const slash = doc.path.indexOf('/');
      return {
        href: doc.href,
        title: doc.title,
        topic: slash > 0 ? doc.path.slice(0, slash) : '',
        date: dateKey(doc.updated),
      };
    })
    .toSorted((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}
