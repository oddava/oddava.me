// Which documents the visual editor produced itself.
//
// The surface is a controlled component: it splices an edit, hands the whole
// new document upward, and gets it back as a prop. It also has to notice when
// a document arrives that it did *not* produce — a note switch, an insert from
// a dialog — because then the block it had open, the caret it had queued and
// the undo stack it had built all belong to a file that is no longer on screen.
//
// Telling those apart by remembering only the newest emission is wrong, and
// wrong in a way that only shows up under a fast typist. Effects run after
// paint, so a keystroke that emits again before the previous render's effect
// has flushed hands that effect an older document than the newest one emitted.
// Compared against a single slot, that reads as a document from elsewhere: the
// editor closes the block mid-word — and, having written the older value back
// into the slot, guarantees the next check fails too. From then on every
// keystroke closes the block, and the text ends up in the block below.
//
// Remembering a short run of recent emissions removes the race entirely: the
// question "did this come from me?" stops depending on when anything ran.

/** Deep enough for any plausible backlog of un-flushed renders. */
export const EMITTED_MEMORY = 8;

/**
 * A bounded, insertion-ordered set of the documents a surface has emitted.
 *
 * Whole strings, like the undo stack: a note is prose, and eight of them cost
 * a fraction of the two hundred snapshots the history already holds.
 */
export type Emissions = Set<string>;

export function emissionsFrom(doc: string): Emissions {
  return new Set([doc]);
}

/**
 * Record a document as one of ours, dropping the oldest once the run is full.
 *
 * Re-emitting something already remembered moves it to the front rather than
 * leaving it near the eviction end — undo, or typing a character and deleting
 * it again, both legitimately return the document to an earlier state.
 */
export function remember(emissions: Emissions, doc: string): void {
  emissions.delete(doc);
  emissions.add(doc);
  while (emissions.size > EMITTED_MEMORY) {
    const oldest = emissions.values().next().value;
    if (oldest === undefined) break;
    emissions.delete(oldest);
  }
}

/** Whether `doc` is one this surface produced, however late it arrived. */
export function isOurs(emissions: Emissions, doc: string): boolean {
  return emissions.has(doc);
}
