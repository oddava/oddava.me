import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ContentEntryMove } from '../../lib/contracts';
import { fetchContentEntry, updateContentEntry } from './api';
import { titleFromBody } from './studioHelpers';
import { AUTOSAVE_DELAY_MS, type SaveState } from './studioSession';

// The open note, mirrored in a ref so the autosave loop always writes the
// latest keystrokes without re-subscribing on every change.
export interface OpenDoc {
  id: string;
  folder: string;
  fields: Record<string, unknown>;
  body: string;
  revision: string;
}

interface Options {
  collectionId: string | null;
  /** A successful write — the workspace refreshes the entry's row from this. */
  onSaved: (id: string, revision: string, title: string, icon?: string) => void;
  onError: (message: string | null) => void;
  /**
   * The store refused a save because the note changed (`stale`) or is gone
   * (`gone`). Saving is already paused when this fires.
   */
  onSaveRejected?: (reason: 'stale' | 'gone') => void;
}

export interface StudioDocument {
  openId: string;
  body: string;
  saveState: SaveState;
  savedAt: number | null;
  /** Edits exist that the store does not have yet (including failed writes). */
  hasUnsavedWork: boolean;
  docRef: { current: OpenDoc | null };
  setBody: (value: string) => void;
  /** Record an edit: mirror it into the doc ref and schedule the autosave. */
  markDirty: (next: Partial<OpenDoc>) => void;
  /** Rename/move bookkeeping — updates the doc without marking it dirty. */
  patch: (next: Partial<OpenDoc>) => void;
  applyMoves: (moves: ContentEntryMove[]) => void;
  /** Flush edits and load an entry. Null means a newer selection superseded it. */
  open: (id: string, folderHint?: string) => Promise<string | null>;
  /** Drop the open document if it is `id` (after a delete, say). */
  closeIfOpen: (id: string) => void;
  saveNow: () => Promise<boolean>;
  clearScheduledSave: () => void;
  hasPendingWrites: () => boolean;
  /** A save request is on the wire. */
  isSaving: () => boolean;
  /** While paused nothing is written, and the edits stay put. */
  setPaused: (paused: boolean) => void;
  /** Replace the open note with the store's version; nothing is left unsaved. */
  replaceFromStore: (
    next: Pick<OpenDoc, 'fields' | 'body' | 'revision'>,
  ) => void;
  /** Take the store's revision; `inSync` when the store already has our text. */
  adoptRevision: (revision: string, inSync: boolean) => void;
}

/**
 * Owns the open note and the write loop behind it. Writes are serialized
 * through one queue: a save snapshots the document only when it reaches the
 * front, so edits made during an earlier request use the new revision that
 * request returned. Document switches await the same queue and cannot strand
 * the previous note's final keystrokes.
 */
export function useStudioDocument({
  collectionId,
  onSaved,
  onError,
  onSaveRejected,
}: Options): StudioDocument {
  const [openId, setOpenId] = useState('');
  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const docRef = useRef<OpenDoc | null>(null);
  const saveTimer = useRef<number | null>(null);
  const documentVersionRef = useRef(0);
  const persistedVersionRef = useRef(0);
  const openRequestRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);
  // An unresolved conflict: writing now would bury someone else's version.
  const pausedRef = useRef(false);
  const savingRef = useRef(false);
  // Mirror callbacks so `saveNow` keeps a stable identity.
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);
  const onSaveRejectedRef = useRef(onSaveRejected);
  onSavedRef.current = onSaved;
  onErrorRef.current = onError;
  onSaveRejectedRef.current = onSaveRejected;

  const clearScheduledSave = useCallback(() => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      openRequestRef.current += 1;
      clearScheduledSave();
    },
    [clearScheduledSave],
  );

  const scheduleSave = useCallback(() => {
    clearScheduledSave();
    if (pausedRef.current) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNowRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [clearScheduledSave]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearScheduledSave();
    const requestedDoc = docRef.current;
    if (!collectionId || !requestedDoc?.id) return true;
    const requestedId = requestedDoc.id;
    const requestedVersion = documentVersionRef.current;

    let saved = true;
    const queued = saveQueueRef.current.then(async () => {
      const current = docRef.current;
      if (
        !current ||
        current.id !== requestedId ||
        persistedVersionRef.current >= requestedVersion
      ) {
        return;
      }
      if (pausedRef.current) {
        saved = false;
        return;
      }

      const snapshot = { ...current, fields: { ...current.fields } };
      const snapshotVersion = documentVersionRef.current;
      setSaveState('saving');
      savingRef.current = true;
      try {
        const response = await updateContentEntry(collectionId, snapshot.id, {
          fields: snapshot.fields,
          body: snapshot.body,
          revision: snapshot.revision,
        });
        const nextRevision =
          response.entry?.revision ?? response.result.revision;
        if (!nextRevision) throw new Error('The save returned no revision.');

        onSavedRef.current(
          snapshot.id,
          nextRevision,
          titleFromBody(snapshot.body, snapshot.id),
          typeof snapshot.fields.icon === 'string'
            ? snapshot.fields.icon
            : undefined,
        );
        if (docRef.current?.id === snapshot.id) {
          docRef.current = { ...docRef.current, revision: nextRevision };
          persistedVersionRef.current = snapshotVersion;
          if (documentVersionRef.current === snapshotVersion) {
            setSaveState('saved');
            setSavedAt(Date.now());
          } else {
            setSaveState('dirty');
          }
        }
      } catch (caught) {
        saved = false;
        if (docRef.current?.id === snapshot.id) {
          const code = (caught as Error & { code?: string }).code;
          if (code === 'content_busy') {
            setSaveState('dirty');
            onErrorRef.current(null);
            scheduleSave();
            return;
          }
          if (code === 'revision_conflict' || code === 'not_found') {
            // Retrying with the same revision can only fail the same way, so
            // this is a decision for the author rather than a save error.
            pausedRef.current = true;
            setSaveState('dirty');
            onErrorRef.current(null);
            onSaveRejectedRef.current?.(
              code === 'not_found' ? 'gone' : 'stale',
            );
            return;
          }
          setSaveState('error');
          onErrorRef.current(
            caught instanceof Error
              ? caught.message
              : 'Could not save the note.',
          );
        }
      } finally {
        savingRef.current = false;
      }
    });
    saveQueueRef.current = queued.catch(() => undefined);
    await queued;
    return saved;
  }, [clearScheduledSave, collectionId, scheduleSave]);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const hasUnsavedWork =
    saveState === 'dirty' || saveState === 'saving' || saveState === 'error';

  // Browsers do not await async work in beforeunload. Flush when the page first
  // becomes hidden, then retain a native leave-page warning while work remains.
  // A failed save ('error') still holds unsaved edits, so it must warn and retry
  // on hide too — otherwise closing the tab after a save error loses them silently.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && hasUnsavedWork) {
        void saveNow();
      }
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (hasUnsavedWork) {
        event.preventDefault();
        Reflect.set(event, 'returnValue', '');
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [hasUnsavedWork, saveNow]);

  const markDirty = useCallback(
    (next: Partial<OpenDoc>) => {
      const doc = docRef.current;
      if (!doc) return;
      docRef.current = { ...doc, ...next };
      documentVersionRef.current += 1;
      setSaveState('dirty');
      scheduleSave();
    },
    [scheduleSave],
  );

  const patch = useCallback((next: Partial<OpenDoc>) => {
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = { ...doc, ...next };
    if (next.id) setOpenId(next.id);
  }, []);

  const applyMoves = useCallback(
    (moves: ContentEntryMove[]) => {
      const current = docRef.current;
      if (!current) return;
      const move = moves.find((item) => item.previousId === current.id);
      if (!move) return;
      patch({
        id: move.entry.id,
        folder: move.entry.folder,
        // Adopt only a revision descended from our own snapshot. If another
        // editor changed the body first, keeping our old revision preserves CAS.
        ...(current.revision === move.previousRevision
          ? { revision: move.entry.revision }
          : {}),
      });
    },
    [patch],
  );

  const open = useCallback(
    async (id: string, folderHint?: string): Promise<string | null> => {
      const request = ++openRequestRef.current;
      if (!collectionId) return null;
      if (docRef.current?.id === id) return docRef.current.folder;
      let response;
      try {
        response = await fetchContentEntry(collectionId, id);
        // Loading can overlap typing or an earlier save. Drain all edits,
        // including failed saves and edits made while a save was in flight,
        // before replacing the document. A render's saveState is not a guard.
        while (request === openRequestRef.current) {
          if (documentVersionRef.current <= persistedVersionRef.current) break;
          if (!(await saveNow())) {
            throw new Error(
              pausedRef.current
                ? 'Choose a version of this note first — its banner has the options.'
                : 'Save the current note before opening another.',
            );
          }
        }
      } catch (error) {
        if (request !== openRequestRef.current) return null;
        throw error;
      }
      if (request !== openRequestRef.current) return null;
      clearScheduledSave();
      const entry = response.entry;
      const folder = entry.folder ?? folderHint ?? '';
      docRef.current = {
        id,
        folder,
        fields: entry.fields,
        body: entry.body ?? '',
        revision: entry.revision,
      };
      documentVersionRef.current = 0;
      persistedVersionRef.current = 0;
      pausedRef.current = false;
      setOpenId(id);
      setBody(entry.body ?? '');
      setSaveState('idle');
      setSavedAt(null);
      return folder;
    },
    [collectionId, saveNow, clearScheduledSave],
  );

  const closeIfOpen = useCallback(
    (id: string) => {
      if (docRef.current?.id !== id) return;
      openRequestRef.current += 1;
      clearScheduledSave();
      docRef.current = null;
      documentVersionRef.current = 0;
      persistedVersionRef.current = 0;
      pausedRef.current = false;
      setOpenId('');
      setBody('');
      setSaveState('idle');
      setSavedAt(null);
    },
    [clearScheduledSave],
  );

  const hasPendingWrites = useCallback(
    () => documentVersionRef.current > persistedVersionRef.current,
    [],
  );

  const isSaving = useCallback(() => savingRef.current, []);

  const setPaused = useCallback(
    (paused: boolean) => {
      pausedRef.current = paused;
      if (!paused && documentVersionRef.current > persistedVersionRef.current) {
        scheduleSave();
      }
    },
    [scheduleSave],
  );

  const replaceFromStore = useCallback(
    (next: Pick<OpenDoc, 'fields' | 'body' | 'revision'>) => {
      const doc = docRef.current;
      if (!doc) return;
      clearScheduledSave();
      docRef.current = { ...doc, ...next };
      documentVersionRef.current = 0;
      persistedVersionRef.current = 0;
      setBody(next.body);
      setSaveState('idle');
    },
    [clearScheduledSave],
  );

  const adoptRevision = useCallback((revision: string, inSync: boolean) => {
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = { ...doc, revision };
    if (!inSync) return;
    persistedVersionRef.current = documentVersionRef.current;
    setSaveState('saved');
    setSavedAt(Date.now());
  }, []);

  return {
    openId,
    body,
    saveState,
    savedAt,
    hasUnsavedWork,
    docRef,
    setBody,
    markDirty,
    patch,
    applyMoves,
    open,
    closeIfOpen,
    saveNow,
    clearScheduledSave,
    hasPendingWrites,
    isSaving,
    setPaused,
    replaceFromStore,
    adoptRevision,
  };
}
