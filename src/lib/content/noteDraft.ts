/**
 * A note is a draft when its frontmatter says `draft: true`. Absence means
 * published, so a published note carries no key at all and an old export or a
 * note written by a client that has never heard of drafts stays public.
 */

/**
 * Lenient on purpose: this decides what stays hidden, so a hand-edited
 * `draft: "true"` must still hide the note. Anything unrecognised reads as
 * published, matching what an absent key means.
 */
export function parseDraftFlag(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function isDraftNote(note: { draft?: unknown }): boolean {
  return parseDraftFlag(note.draft);
}
