import { parseDraftFlag } from '../../lib/content/noteDraft';
import type { ContentEntryListItem } from '../../lib/contracts';

/**
 * Studio's side of unlisting. The rules for what a draft *is* live in
 * `lib/content/noteDraft`; this is only how the editor talks about it.
 */
export type DraftState = 'draft' | 'published';

export const DRAFT_STATES: readonly DraftState[] = ['draft', 'published'];

export const DRAFT_LABELS: Record<DraftState, string> = {
  draft: 'Draft',
  published: 'Published',
};

/**
 * A note made in Studio starts unlisted. Autosave writes to the live store on
 * every pause, so without this the first keystrokes of a new note would be
 * public before the writer has decided anything. The Notes API deliberately
 * does not do this — its clients create finished notes.
 */
export const NEW_NOTE_FIELDS: Record<string, unknown> = { draft: true };

export function draftStateOf(
  note: { draft?: unknown } | null | undefined,
): DraftState {
  return note && parseDraftFlag(note.draft) ? 'draft' : 'published';
}

/** The front door of the garden cannot be unlisted; there would be no garden. */
export function canToggleDraft(
  entry: Pick<ContentEntryListItem, 'id' | 'folder'> | null | undefined,
): boolean {
  return Boolean(entry) && !(entry!.id === 'index' && entry!.folder === '');
}

/**
 * Publishing removes the key rather than writing `draft: false`, so a
 * published note's frontmatter is exactly what it was before drafts existed.
 */
export function withDraftState(
  fields: Record<string, unknown>,
  state: DraftState,
): Record<string, unknown> {
  const next = { ...fields };
  delete next.draft;
  return state === 'draft' ? { ...next, draft: true } : next;
}

/** One name, kept short enough for a toast on a phone. */
function quotedTitle(title: string): string {
  const trimmed = title.trim() || 'Your note';
  return trimmed.length > 36 ? `“${trimmed.slice(0, 35)}…”` : `“${trimmed}”`;
}

export function draftNotice(title: string, state: DraftState): string {
  return state === 'published'
    ? `Published! ${quotedTitle(title)} is live for everyone now.`
    : `${quotedTitle(title)} is a draft again — only you can see it.`;
}

export function nextDraftState(state: DraftState): DraftState {
  return state === 'draft' ? 'published' : 'draft';
}

/** The radio the arrow keys land on, wrapping like a native radio group. */
export function stepDraftState(state: DraftState, step: 1 | -1): DraftState {
  const index = DRAFT_STATES.indexOf(state);
  return DRAFT_STATES[
    (index + step + DRAFT_STATES.length) % DRAFT_STATES.length
  ]!;
}
