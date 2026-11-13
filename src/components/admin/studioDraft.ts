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

/**
 * The option an arrow key moves focus to. It stops at either end rather than
 * wrapping: with two options a wrap turns every arrow press into "the other
 * one", and the arrows only ever move focus — choosing takes Space or Enter.
 */
export function stepDraftState(state: DraftState, step: 1 | -1): DraftState {
  const index = DRAFT_STATES.indexOf(state) + step;
  return DRAFT_STATES[Math.max(0, Math.min(DRAFT_STATES.length - 1, index))]!;
}

/** Who can see each state, for the control's tooltips and the phone sheet. */
export const DRAFT_HINTS: Record<DraftState, string> = {
  draft: 'Only you can see drafts.',
  published: 'Anyone can read published notes.',
};

/**
 * A restore brings back words, never visibility: the note keeps its own draft
 * flag, whatever the version had. (The server applies the same rule; this is
 * the client's side of it for responses that do not say.)
 */
export function keepDraftState(
  restored: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  return withDraftState(restored, draftStateOf(current));
}

const NEW_DRAFT_NOTICE_KEY = 'oddava.studio.newDraftNoticeSeen';

export const NEW_DRAFT_NOTICE =
  'New notes start as drafts — publish when you’re ready.';

/**
 * The friendly word about drafts, the first time Studio makes one, and never
 * again on this browser. Storage that cannot be read or written (private mode)
 * says nothing rather than repeating itself on every note.
 */
export function takeNewDraftNotice(
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): string | null {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (!store || store.getItem(NEW_DRAFT_NOTICE_KEY)) return null;
    store.setItem(NEW_DRAFT_NOTICE_KEY, '1');
    return NEW_DRAFT_NOTICE;
  } catch {
    return null;
  }
}
