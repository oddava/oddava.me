// How the version history dates a version: relative ages, exact stamps and the
// day headings. Pure, so the calendar edge cases are the tested part.

import type { NoteRevisionMeta } from '../../lib/history-contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days between two moments, by the viewer's own clock. */
function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / (24 * HOUR));
}

function dateLabel(timestamp: number, now: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(new Date(timestamp).getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: 'numeric' }),
  });
}

function clockLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * How long ago a version was current, the way a person would say it.
 * Never negative: a clock that runs a little behind the server's reads as
 * "just now" rather than as the future.
 */
export function formatVersionAge(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 45_000) return 'Just now';
  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.round(elapsed / MINUTE));
    return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  }
  const days = daysBetween(timestamp, now);
  if (days === 0) {
    const hours = Math.round(elapsed / HOUR);
    return hours === 1 ? '1 hr ago' : `${hours} hr ago`;
  }
  if (days === 1) return `Yesterday, ${clockLabel(timestamp)}`;
  if (days < 7) return `${days} days ago`;
  return dateLabel(timestamp, now);
}

/** The full date and time, for a tooltip and a screen reader. */
export function formatVersionExact(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * When a version belongs in the timeline. A saved copy is dated by when its
 * words were written; the copy a restore sets aside is dated by the restore,
 * because that is the moment someone will be looking for.
 */
export function versionTimestamp(version: NoteRevisionMeta): number {
  if (version.reason === 'pre-restore') return version.recordedAt;
  const saved = Date.parse(version.at);
  return Number.isNaN(saved) ? version.recordedAt : saved;
}

export interface VersionGroup {
  label: string;
  versions: NoteRevisionMeta[];
}

/** Today, Yesterday, then a date — in the order the versions arrive. */
export function groupVersionsByDay(
  versions: readonly NoteRevisionMeta[],
  now: number,
): VersionGroup[] {
  const groups: VersionGroup[] = [];
  for (const version of versions) {
    const timestamp = versionTimestamp(version);
    const days = daysBetween(timestamp, now);
    const label =
      days <= 0
        ? 'Today'
        : days === 1
          ? 'Yesterday'
          : new Date(timestamp).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              ...(new Date(timestamp).getFullYear() ===
              new Date(now).getFullYear()
                ? {}
                : { year: 'numeric' }),
            });
    const last = groups.at(-1);
    if (last?.label === label) last.versions.push(version);
    else groups.push({ label, versions: [version] });
  }
  return groups;
}
