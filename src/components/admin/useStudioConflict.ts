import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createContentEntry, fetchContentEntry } from './api';
import {
  CLEAR,
  choose,
  isPaused,
  observe,
  saved,
  type ConflictChoice,
  type ConflictEffect,
  type ConflictState,
  type LocalNote,
  type Reading,
} from './studioConflict';
import type { OnNoteStored, StudioDocument } from './useStudioDocument';

/** How often an open note is compared with the store while the tab is shown. */
const POLL_MS = 20_000;
/** Focus and visibility events arrive in bursts; one check answers them all. */
const MIN_GAP_MS = 4_000;
/** After a refused save whose follow-up read failed, wait before trying again. */
const RETRY_AFTER_FAILED_READ_MS = 3_000;

interface Options {
  collectionId: string | null;
  doc: StudioDocument;
  /** The store's version is now the open one: refresh the list row. */
  onAdopted: OnNoteStored;
  /** The open note no longer exists: close its tab and refresh the list. */
  onGone: (id: string) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  /**
   * The author has the caret in the note. A newer version then waits for them
   * to choose instead of replacing the text under it; see `LocalNote.editing`.
   */
  isEditing?: () => boolean;
}

export interface StudioConflict {
  state: ConflictState;
  /** An action is in flight, so the banner's buttons wait. */
  busy: boolean;
  /** Wire to `useStudioDocument`'s `onSaveRejected`. */
  handleSaveRejected: (reason: 'stale' | 'gone') => void;
  pick: (choice: ConflictChoice) => Promise<void>;
  /** Put the author's text on the clipboard; false when the browser refuses. */
  copyMine: () => Promise<boolean>;
}

async function readStore(
  collectionId: string,
  id: string,
): Promise<Reading | null> {
  try {
    const { entry } = await fetchContentEntry(collectionId, id);
    return {
      kind: 'found',
      note: {
        revision: entry.revision,
        body: entry.body ?? '',
        fields: entry.fields,
      },
    };
  } catch (caught) {
    if ((caught as Error & { code?: string }).code === 'not_found') {
      return { kind: 'missing' };
    }
    // Offline or a busy store says nothing about the note; look again later.
    return null;
  }
}

/**
 * Notices when the open note was changed or removed by someone else (another
 * tab, the Notes API, the Obsidian plugin) and walks the author through it.
 * Decisions live in `studioConflict`; this hook only reads the store, applies
 * the resulting effects and keeps autosave paused while a choice is pending.
 *
 * It is the only thing that pauses or resumes saving. The document reports a
 * refused save and stops there; whether to wait, and for how long, is decided
 * here.
 */
export function useStudioConflict({
  collectionId,
  doc,
  onAdopted,
  onGone,
  onNotice,
  onError,
  isEditing,
}: Options): StudioConflict {
  const [state, setState] = useState<ConflictState>(CLEAR);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef<ConflictState>(CLEAR);
  // Text set aside outlives a tab switch; the other states are about the
  // document on screen and end with it.
  const asideRef = useRef(new Map<string, ConflictState>());
  const checkingRef = useRef(false);
  const lastCheckRef = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const callbacks = useRef({ onAdopted, onGone, onNotice, onError, isEditing });
  callbacks.current = { onAdopted, onGone, onNotice, onError, isEditing };

  const { openId } = doc;

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const apply = useCallback(
    (next: ConflictState) => {
      const current = docRef.current;
      stateRef.current = next;
      setState(next);
      clearRetry();
      current.setPaused(isPaused(next));
      const id = current.docRef.current?.id;
      if (!id) return;
      if (next.kind === 'set-aside') asideRef.current.set(id, next);
      else asideRef.current.delete(id);
    },
    [clearRetry],
  );

  useEffect(() => {
    // A different note: its own set-aside text, or nothing to resolve.
    const next = asideRef.current.get(openId) ?? CLEAR;
    stateRef.current = next;
    setState(next);
    docRef.current.setPaused(isPaused(next));
    return clearRetry;
  }, [openId, clearRetry]);

  const localNote = useCallback((): LocalNote | null => {
    const current = docRef.current;
    const open = current.docRef.current;
    if (!open) return null;
    return {
      revision: open.revision,
      body: open.body,
      fields: open.fields,
      dirty: current.hasPendingWrites(),
      editing:
        current.documentVersion() > 0 &&
        Boolean(callbacks.current.isEditing?.()),
    };
  }, []);

  const run = useCallback(
    async (effect: ConflictEffect): Promise<void> => {
      const current = docRef.current;
      const open = current.docRef.current;
      if (!open || !collectionId) return;
      const { onAdopted, onGone, onNotice, onError } = callbacks.current;

      if (effect.type === 'adopt-revision') {
        // Decided on the text as it is right now, so all of it is in step.
        current.adoptRevision(effect.revision, current.documentVersion());
        onAdopted(open.id, effect.revision, open.body, open.fields);
      } else if (effect.type === 'load') {
        const { theirs } = effect;
        current.replaceFromStore(theirs);
        onAdopted(open.id, theirs.revision, theirs.body, theirs.fields);
        if (effect.quiet) onNotice('Refreshed — this note changed elsewhere.');
      } else if (effect.type === 'overwrite') {
        // Their revision is the new base, so the store accepts our text.
        current.adoptRevision(effect.revision);
        // Kept while editing with nothing unsaved: what is on screen still has
        // to be written over theirs, or "keep mine" would keep nothing.
        if (!current.hasPendingWrites()) current.markDirty({});
        setBusy(true);
        try {
          await current.saveNow();
        } finally {
          setBusy(false);
        }
      } else if (effect.type === 'restore') {
        current.setBody(effect.text.body);
        current.markDirty({
          body: effect.text.body,
          fields: effect.text.fields,
        });
      } else if (effect.type === 'recreate') {
        // The request carries the text as it is now; anything typed while it
        // is out must stay unsaved, so only this version is acknowledged.
        const sentVersion = current.documentVersion();
        const sentGeneration = current.generation();
        const sent = { body: open.body, fields: open.fields };
        setBusy(true);
        try {
          const response = await createContentEntry(collectionId, {
            slug: open.id,
            folder: open.folder,
            fields: sent.fields,
            body: sent.body,
          });
          const revision = response.entry?.revision ?? response.result.revision;
          if (!revision) throw new Error('The save returned no revision.');
          // The row describes the stored note whichever note is open now.
          onAdopted(open.id, revision, sent.body, sent.fields);
          const now = docRef.current;
          if (
            now.generation() !== sentGeneration ||
            now.docRef.current?.id !== open.id
          ) {
            return;
          }
          now.adoptRevision(revision, sentVersion);
          apply(saved(stateRef.current));
          onNotice('Saved your note again.');
        } catch (caught) {
          onError(
            caught instanceof Error
              ? caught.message
              : 'Could not save the note again.',
          );
        } finally {
          setBusy(false);
        }
      } else if (effect.type === 'close') {
        current.closeIfOpen(open.id);
        onGone(open.id);
      }
    },
    [apply, collectionId],
  );

  const resolve = useCallback(
    (reading: Reading) => {
      const local = localNote();
      if (!local) return;
      const outcome = observe(stateRef.current, reading, local);
      apply(outcome.state);
      void run(outcome.effect);
    },
    [apply, localNote, run],
  );

  const check = useCallback(
    async (origin: 'poll' | 'save') => {
      const open = docRef.current.docRef.current;
      if (!open || !collectionId) return;
      // A refused save must always be explained, so only polls queue behind
      // one another.
      if (origin === 'poll') {
        if (checkingRef.current) return;
        checkingRef.current = true;
      }
      lastCheckRef.current = Date.now();
      const { id, revision } = open;
      try {
        const reading = await readStore(collectionId, id);
        const now = docRef.current.docRef.current;
        if (!now || now.id !== id) return;
        if (!reading) {
          // The refused save left autosave paused with nothing to show for
          // it. Let it try again rather than strand the author — unless a
          // choice has come up in the meantime.
          if (origin === 'save') {
            clearRetry();
            retryTimer.current = window.setTimeout(() => {
              retryTimer.current = null;
              docRef.current.setPaused(isPaused(stateRef.current));
            }, RETRY_AFTER_FAILED_READ_MS);
          }
          return;
        }
        // Our own save landing mid-read makes the store look "ahead" of the
        // revision we still hold; that is not someone else's change.
        // And a poll that finished after a refused save would only repeat,
        // possibly with an older reading, what that save already found.
        if (origin === 'poll') {
          if (now.revision !== revision || docRef.current.isSaving()) return;
          if (isPaused(stateRef.current)) return;
        }
        resolve(reading);
      } finally {
        if (origin === 'poll') checkingRef.current = false;
      }
    },
    [clearRetry, collectionId, resolve],
  );

  useEffect(() => {
    if (!openId || !collectionId) return;
    function revalidate() {
      if (document.visibilityState !== 'visible') return;
      if (isPaused(stateRef.current)) return;
      if (Date.now() - lastCheckRef.current < MIN_GAP_MS) return;
      void check('poll');
    }
    const timer = window.setInterval(revalidate, POLL_MS);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('focus', revalidate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('focus', revalidate);
    };
  }, [openId, collectionId, check]);

  // A save that succeeds after "keep mine" is what ends the overwrite.
  const { saveState } = doc;
  useEffect(() => {
    if (saveState !== 'saved') return;
    const next = saved(stateRef.current);
    if (next !== stateRef.current) apply(next);
  }, [saveState, apply]);

  const handleSaveRejected = useCallback(
    (reason: 'stale' | 'gone') => {
      // Hold every write now; the read that explains the refusal decides
      // what happens next. Retrying meanwhile could only be refused again.
      docRef.current.setPaused(true);
      if (reason === 'gone') resolve({ kind: 'missing' });
      else void check('save');
    },
    [check, resolve],
  );

  const copyMine = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    const text =
      current.kind === 'set-aside'
        ? current.mine.body
        : (docRef.current.docRef.current?.body ?? '');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  const pick = useCallback(
    async (choice: ConflictChoice) => {
      const local = localNote();
      if (!local) return;
      // Closing a note whose text exists nowhere else must not lose it.
      if (choice === 'close' && local.dirty && !(await copyMine())) {
        callbacks.current.onError(
          'Could not copy your text. Copy it from the note, then close.',
        );
        return;
      }
      if (choice === 'close' && local.dirty) {
        callbacks.current.onNotice('Closed. Your text is on the clipboard.');
      }
      const outcome = choose(stateRef.current, choice, local);
      apply(outcome.state);
      await run(outcome.effect);
    },
    [apply, copyMine, localNote, run],
  );

  return { state, busy, handleSaveRejected, pick, copyMine };
}
