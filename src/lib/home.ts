import type { Project } from './contracts';
import type { GardenDocument } from './garden/types';

/** How many projects and note topics the home page shows below the hero. */
export const HOME_PROJECT_LIMIT = 3;
export const HOME_SHELF_LIMIT = 3;

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
  /** The note's own one-line summary; `''` when it has none. */
  summary: string;
  /** `YYYY-MM-DD`, or `''` when the note carries no readable date. */
  date: string;
}

/** One topic on home: a top-level folder of the garden and its newest note. */
export interface HomeShelf {
  /** The folder's name as it appears in note paths, e.g. `reading`. */
  topic: string;
  /** The folder's hub note, or the garden root for notes at the top level. */
  href: string;
  latest: HomeNote;
  /** How many other notes the folder holds. */
  more: number;
}

function dateKey(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

const newestFirst = (left: HomeNote, right: HomeNote) =>
  right.date.localeCompare(left.date);

/**
 * The garden by topic: each top-level folder with its newest note, the
 * folders with the freshest writing first. Only leaves count — the root note
 * is the notes page itself, and a note with notes under it is a folder's hub,
 * which an edit to any child would otherwise keep on top. Notes outside any
 * folder share one shelf that points at the garden's root.
 */
export function pickNoteShelves(
  documents: readonly GardenDocument[],
  root: Pick<GardenDocument, 'id' | 'href'>,
  limit = HOME_SHELF_LIMIT,
): HomeShelf[] {
  const groups = new Map<string, HomeNote[]>();
  for (const document of documents) {
    if (document.id === root.id || document.childIds.length > 0) continue;
    const slash = document.path.indexOf('/');
    const topic = slash > 0 ? document.path.slice(0, slash) : '';
    const notes = groups.get(topic) ?? [];
    notes.push({
      href: document.href,
      title: document.title,
      summary: document.summary.trim(),
      date: dateKey(document.updated),
    });
    groups.set(topic, notes);
  }
  const hubs = new Map(documents.map((document) => [document.path, document]));
  return [...groups]
    .map(([topic, notes]) => {
      const [latest, ...rest] = notes.toSorted(newestFirst);
      return {
        topic: topic || 'notes',
        href: (topic && hubs.get(topic)?.href) || root.href,
        latest: latest!,
        more: rest.length,
      };
    })
    .toSorted((left, right) => newestFirst(left.latest, right.latest))
    .slice(0, limit);
}
