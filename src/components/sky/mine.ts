/**
 * The stars you left, remembered in this browser only: their ids, the word
 * you gave each (so your own star shows your word while it waits to be
 * read), and when you placed it (so the page can say "that's three today"
 * before you write a word, not after). Nothing here is sent anywhere.
 */

const KEY = 'sky:mine';
const LIMIT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches STAR_RATE_LIMIT on the server: three a day, in UTC days. */
export const STARS_PER_DAY = 3;

export interface MyStar {
  id: string;
  word?: string;
  /** When it was placed, ms since the epoch. */
  at?: number;
}

export function readMine(): MyStar[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const { id, word, at } = item as Record<string, unknown>;
      if (typeof id !== 'string') return [];
      return [
        {
          id,
          ...(typeof word === 'string' && word ? { word } : {}),
          ...(typeof at === 'number' && Number.isFinite(at) ? { at } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function rememberMine(star: MyStar): MyStar[] {
  const next = [star, ...readMine().filter((item) => item.id !== star.id)];
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, LIMIT)));
  } catch {
    // Private mode or full storage: the star is placed either way.
  }
  return next;
}

/**
 * How many of your stars landed in the server's current day (its limit
 * counts in fixed UTC days), and when that day ends. A guide only: the
 * server decides, and another browser of yours is not counted here.
 */
export function placedToday(
  mine: MyStar[],
  now = Date.now(),
): { count: number; resetsAt: number } {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  return {
    count: mine.filter((star) => (star.at ?? 0) >= dayStart).length,
    resetsAt: dayStart + DAY_MS,
  };
}
