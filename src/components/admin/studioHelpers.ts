// Pure helpers shared by the Studio workspace, its hooks and its panes.

import { parseDraftFlag } from '../../lib/content/noteDraft';
import type { ContentEntryListItem } from '../../lib/contracts';
import { noteUrl } from '../../lib/notes-url';

/** A note's display name is its first heading, falling back to its slug. */
export function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || fallback.replaceAll('-', ' ') || 'Untitled';
}

/** Every key is always present, so spreading it clears a stale value too. */
export interface NoteRowPatch {
  title: string;
  icon: string | undefined;
  draft: true | undefined;
}

/**
 * What a list row shows of a note, derived from the note itself. Every path
 * that adopts a stored version — a save, a restore, either side of a conflict —
 * refreshes the row through this, so no part of the row (the draft pill reads
 * `draft`) can drift from the note it describes.
 */
export function rowPatchFromNote(
  id: string,
  body: string,
  fields: Record<string, unknown>,
): NoteRowPatch {
  return {
    title: titleFromBody(body, id),
    icon: typeof fields.icon === 'string' ? fields.icon : undefined,
    draft: parseDraftFlag(fields.draft) ? true : undefined,
  };
}

// The same test ProseMirror's keymap makes for "Mod", so a Studio shortcut
// and an editor binding never disagree about which key is the command key.
const APPLE =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);

type ModifierKeys = Pick<
  KeyboardEvent,
  'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

/**
 * The platform's command key, and only it: ⌘ on a Mac, Ctrl everywhere else.
 * A Mac's Ctrl belongs to text editing (Ctrl+F is "forward a character",
 * Ctrl+P "previous line"), and Windows' Meta belongs to the OS, so neither is
 * ever read as the other.
 */
export function isMod(event: ModifierKeys, apple = APPLE): boolean {
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/**
 * Back (-1) or forward (1) through the notes visited, or 0. Alt+← / Alt+→
 * off a Mac; ⌘[ / ⌘] on one, where ⌥← / ⌥→ move the caret by a word.
 */
export function historyStep(
  event: ModifierKeys & Pick<KeyboardEvent, 'key'>,
  apple = APPLE,
): -1 | 0 | 1 {
  if (apple) {
    if (!isMod(event, true) || event.altKey || event.shiftKey) return 0;
    return event.key === '[' ? -1 : event.key === ']' ? 1 : 0;
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return 0;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
}

/**
 * A shortcut the way this keyboard labels it: `shortcut('K')` is ⌘K on a Mac
 * and Ctrl+K everywhere else.
 */
export function shortcut(key: string, shift = false, apple = APPLE): string {
  if (apple) return `⌘${shift ? '⇧' : ''}${key === 'Backspace' ? '⌫' : key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** The same for Alt: ⌥↑ on a Mac, Alt+↑ elsewhere. */
export function altShortcut(key: string, apple = APPLE): string {
  return apple ? `⌥${key}` : `Alt+${key}`;
}

/** Back / forward as this keyboard presses them (see `historyStep`). */
export function historyShortcuts(
  apple = APPLE,
): [back: string, forward: string] {
  return apple ? ['⌘[', '⌘]'] : ['Alt+←', 'Alt+→'];
}

export function noteHref(entries: ContentEntryListItem[], id: string): string {
  return entries.find((entry) => entry.id === id)?.href ?? noteUrl(id);
}

/** Rewrite a folder path (or a path inside it) after its folder moved. */
export function remapFolderPath(
  value: string,
  from: string,
  to: string,
): string {
  if (value === from) return to;
  return value.startsWith(`${from}/`)
    ? `${to}${value.slice(from.length)}`
    : value;
}

export function contentRequestError(caught: unknown, fallback: string): string {
  if (
    caught instanceof Error &&
    (caught.name === 'AbortError' || caught.name === 'TimeoutError')
  ) {
    return 'Files could not reach the local content service. Restart the development server and try again.';
  }
  return caught instanceof Error ? caught.message : fallback;
}
