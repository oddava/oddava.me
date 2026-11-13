// What Studio does when the store holds a different version of the open note
// than the one on screen: another Studio tab, the Notes API, the Obsidian
// plugin. Everything here is a pure decision; the hook reads the store, applies
// the effects and renders the state.
//
// The rule underneath: the author's unsaved text is never overwritten without
// being asked. With nothing unsaved there is nothing to protect, so the newer
// version simply replaces the old one.

export type Fields = Record<string, unknown>;

/** A version of the note as the store has it. */
export interface NoteVersion {
  revision: string;
  body: string;
  fields: Fields;
}

/** The note as Studio shows it. `dirty` means edits the store does not have. */
export interface LocalNote extends NoteVersion {
  dirty: boolean;
}

/** What Studio wrote or typed, kept apart from the store's revision. */
export interface LocalText {
  body: string;
  fields: Fields;
}

/** What a revalidation found. A missing note is gone, not changed. */
export type Reading =
  { kind: 'found'; note: NoteVersion } | { kind: 'missing' };

export type ConflictState =
  | { kind: 'clear' }
  /** The store moved on while there are unsaved edits; autosave is paused. */
  | {
      kind: 'changed';
      theirs: NoteVersion;
      again: boolean;
      aside: LocalText | null;
    }
  /** Deleted or moved elsewhere; autosave is paused. */
  | { kind: 'gone' }
  /** "Keep mine" was chosen and its save is on the way. */
  | { kind: 'overwriting'; theirs: NoteVersion }
  /** Their version was loaded and the author's text is held for recovery. */
  | { kind: 'set-aside'; mine: LocalText };

export type ConflictEffect =
  | { type: 'none' }
  /** Same words under a new revision: adopt the revision, change nothing else. */
  | { type: 'adopt-revision'; revision: string }
  /** Replace the open note with the store's version. */
  | { type: 'load'; theirs: NoteVersion; quiet: boolean }
  /** Take their revision, then save the open text over it. */
  | { type: 'overwrite'; revision: string }
  /** Put set-aside text back as an ordinary unsaved edit. */
  | { type: 'restore'; text: LocalText }
  /** The note is gone: write the open text back at its path. */
  | { type: 'recreate' }
  | { type: 'close' };

export interface Outcome {
  state: ConflictState;
  effect: ConflictEffect;
}

export type ConflictChoice =
  | 'load-theirs'
  | 'keep-mine'
  | 'restore-mine'
  | 'dismiss-aside'
  | 'recreate'
  | 'close';

export const CLEAR: ConflictState = { kind: 'clear' };

const NO_EFFECT: ConflictEffect = { type: 'none' };

/** Autosave must not run, and the save indicator says so. */
export function isPaused(state: ConflictState): boolean {
  return state.kind === 'changed' || state.kind === 'gone';
}

/** Key order is not content: a field map round-trips through JSON. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Fields)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sameContent(a: LocalText, b: LocalText): boolean {
  return a.body === b.body && stable(a.fields) === stable(b.fields);
}

function setAsideText(note: LocalText): LocalText {
  return { body: note.body, fields: { ...note.fields } };
}

/** A resolved or obsolete conflict leaves set-aside text untouched. */
function settled(state: ConflictState): ConflictState {
  return state.kind === 'set-aside' ? state : CLEAR;
}

/**
 * A reading of the store, taken while polling or after a save was refused,
 * against what is on screen.
 */
export function observe(
  state: ConflictState,
  reading: Reading,
  local: LocalNote,
): Outcome {
  if (reading.kind === 'missing') {
    return {
      state: state.kind === 'gone' ? state : { kind: 'gone' },
      effect: NO_EFFECT,
    };
  }

  const theirs = reading.note;
  if (theirs.revision === local.revision) {
    return { state: settled(state), effect: NO_EFFECT };
  }
  if (sameContent(theirs, local)) {
    // Two editors typed the same thing, or a write landed twice. Nothing to
    // choose between; stay in step with the store's revision.
    return {
      state: settled(state),
      effect: { type: 'adopt-revision', revision: theirs.revision },
    };
  }
  if (!local.dirty) {
    return {
      state: settled(state),
      effect: { type: 'load', theirs, quiet: true },
    };
  }
  if (state.kind === 'changed' && state.theirs.revision === theirs.revision) {
    return { state, effect: NO_EFFECT };
  }
  return {
    state: {
      kind: 'changed',
      theirs,
      // A second change on top of an unresolved or just-overwritten one.
      again: state.kind === 'changed' || state.kind === 'overwriting',
      aside: state.kind === 'set-aside' ? state.mine : null,
    },
    effect: NO_EFFECT,
  };
}

/** The author picked a way forward in the banner or the dialog. */
export function choose(
  state: ConflictState,
  choice: ConflictChoice,
  local: LocalNote,
): Outcome {
  if (state.kind === 'changed') {
    if (choice === 'load-theirs') {
      const mine = sameContent(local, state.theirs)
        ? state.aside
        : setAsideText(local);
      return {
        state: mine ? { kind: 'set-aside', mine } : CLEAR,
        effect: { type: 'load', theirs: state.theirs, quiet: false },
      };
    }
    if (choice === 'keep-mine') {
      return {
        state: { kind: 'overwriting', theirs: state.theirs },
        effect: { type: 'overwrite', revision: state.theirs.revision },
      };
    }
  }
  if (state.kind === 'gone') {
    if (choice === 'recreate') return { state, effect: { type: 'recreate' } };
    if (choice === 'close') {
      return { state: CLEAR, effect: { type: 'close' } };
    }
  }
  if (state.kind === 'set-aside') {
    if (choice === 'restore-mine') {
      return { state: CLEAR, effect: { type: 'restore', text: state.mine } };
    }
    if (choice === 'dismiss-aside') return { state: CLEAR, effect: NO_EFFECT };
  }
  return { state, effect: NO_EFFECT };
}

/** A save went through, so whatever was waiting on one is over. */
export function saved(state: ConflictState): ConflictState {
  return state.kind === 'overwriting' || state.kind === 'gone' ? CLEAR : state;
}
