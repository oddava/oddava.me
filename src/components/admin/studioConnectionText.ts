import type { OutboundLink } from '../../lib/garden/connections';

/** A note's path split the way Studio's file list names it: folder and leaf. */
export function splitNotePath(path: string): { folder: string; id: string } {
  const at = path.lastIndexOf('/');
  return at === -1
    ? { folder: '', id: path }
    : { folder: path.slice(0, at), id: path.slice(at + 1) };
}

/** The "Linked from (3)" toggle; the count is part of the name, so it is read. */
export function backlinksHeading(count: number): string {
  return count ? `Linked from (${count})` : 'Linked from';
}

export function outboundHeading(count: number): string {
  return count ? `Links out to (${count})` : 'Links out to';
}

export const NO_BACKLINKS = 'Nothing links here yet — be the first!';
export const NO_OUTBOUND = 'No links out yet. Type [[ to point at a note.';

/** How many of a note's outgoing links have no note behind them yet. */
export function unwrittenCount(links: readonly OutboundLink[]): number {
  return links.filter((link) => link.kind === 'unwritten').length;
}

/** The starter body a created note gets: its name as the title, ready to write. */
export function unwrittenNoteBody(title: string): string {
  return `# ${title}\n\n`;
}

/**
 * Links to notes that exist first, in the order written; the ones still to be
 * written after, so the "not written yet" rows read as a to-do list.
 */
export function orderOutbound(links: readonly OutboundLink[]): OutboundLink[] {
  return [
    ...links.filter((link) => link.kind === 'note'),
    ...links.filter((link) => link.kind === 'unwritten'),
  ];
}
