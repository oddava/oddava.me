import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
  onSaved: (id: string, revision: string, title: string) => void;
  onError: (message: string | null) => void;
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
  /** Load an entry into the editor. Throws; the caller owns busy/error state. */
  open: (id: string, folderHint?: string) => Promise<string>;
  /** Drop the open document if it is `id` (after a delete, say). */
  closeIfOpen: (id: string) => void;
  saveNow: () => Promise<boolean>;
  clearScheduledSave: () => void;
  setAutosave: (enabled: boolean) => void;
  hasPendingWrites: () => boolean;
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
}: Options): StudioDocument {
  const [openId, setOpenId] = useState('');
  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const docRef = useRef<OpenDoc | null>(null);
  const saveTimer = useRef<number | null>(null);
  const documentVersionRef = useRef(0);
  const persistedVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);
  // Mirror the autosave preference in a ref so the save loop reads the latest
  // value without re-subscribing.
  const autosaveRef = useRef(true);
  // Same for the callbacks, so `saveNow` keeps a stable identity.
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);
  onSavedRef.current = onSaved;
  onErrorRef.current = onError;

  const clearScheduledSave = useCallback(() => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearScheduledSave();
    },
    [clearScheduledSave],
  );

  const scheduleSave = useCallback(() => {
    clearScheduledSave();
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

      const snapshot = { ...current, fields: { ...current.fields } };
      const snapshotVersion = documentVersionRef.current;
      setSaveState('saving');
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
          if (
            (caught as Error & { code?: string }).code === 'content_busy' &&
            autosaveRef.current
          ) {
            setSaveState('dirty');
            onErrorRef.current(null);
            scheduleSave();
            return;
          }
          setSaveState('error');
          onErrorRef.current(
            caught instanceof Error
              ? caught.message
              : 'Could not save the note.',
          );
        }
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
      if (
        document.visibilityState === 'hidden' &&
        autosaveRef.current &&
        hasUnsavedWork
      ) {
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
      if (autosaveRef.current) scheduleSave();
    },
    [scheduleSave],
  );

  const patch = useCallback((next: Partial<OpenDoc>) => {
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = { ...doc, ...next };
    if (next.id) setOpenId(next.id);
  }, []);

  const open = useCallback(
    async (id: string, folderHint?: string): Promise<string> => {
      if (!collectionId) return '';
      const response = await fetchContentEntry(collectionId, id);
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
      setOpenId(id);
      setBody(entry.body ?? '');
      setSaveState('idle');
      return folder;
    },
    [collectionId],
  );

  const closeIfOpen = useCallback(
    (id: string) => {
      if (docRef.current?.id !== id) return;
      clearScheduledSave();
      docRef.current = null;
      documentVersionRef.current = 0;
      persistedVersionRef.current = 0;
      setOpenId('');
      setBody('');
      setSaveState('idle');
    },
    [clearScheduledSave],
  );

  const setAutosave = useCallback((enabled: boolean) => {
    autosaveRef.current = enabled;
  }, []);

  const hasPendingWrites = useCallback(
    () => documentVersionRef.current > persistedVersionRef.current,
    [],
  );

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
    open,
    closeIfOpen,
    saveNow,
    clearScheduledSave,
    setAutosave,
    hasPendingWrites,
  };
}
