import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ContentEntryDetail } from '../../lib/contracts';
import type {
  NoteRevisionDetail,
  NoteRevisionMeta,
} from '../../lib/history-contracts';
import { fetchNoteVersion, fetchNoteVersions, restoreNoteVersion } from './api';
import { draftStateOf, keepDraftState } from './studioDraft';
import type { OnNoteStored, StudioDocument } from './useStudioDocument';

export type HistoryStatus = 'loading' | 'ready' | 'error';

interface Options {
  open: boolean;
  collectionId: string | null;
  noteId: string;
  /** Saves what is pending, so the store and the panel talk about one note. */
  flush: () => Promise<boolean>;
  /** The revision the open note has now — what a restore must replace. */
  currentRevision: () => string;
  /**
   * Why a restore cannot be written right now (saving is paused by a
   * conflict), or null. Checked when the restore starts, not only rendered.
   */
  blockedReason: () => string | null;
  /**
   * `fields` is what the note holds after the restore, when the server says
   * (it keeps the note's own draft flag and order); otherwise derive it.
   */
  onRestored: (
    entry: ContentEntryDetail,
    fields: Record<string, unknown> | undefined,
  ) => void;
}

/** The restore response, with the resulting fields once the server sends them. */
type RestoreResponse = Awaited<ReturnType<typeof restoreNoteVersion>> & {
  fields?: Record<string, unknown>;
};

export type RestoreAdoption = 'replaced' | 'edited-meanwhile' | 'not-open';

/**
 * Make a restored version the open note. It goes through `replaceFromStore`,
 * like their side of a conflict, so counters, save state and any scheduled
 * save start over rather than describing the text it replaced.
 *
 * Text typed while the restore was out is not replaced: it is not in the
 * store, and its next save is refused against the restored revision, which
 * brings up the conflict banner with both versions. The row is refreshed in
 * every case, since the store has the restored note either way.
 */
export function adoptRestoredVersion(
  doc: Pick<
    StudioDocument,
    'docRef' | 'hasPendingWrites' | 'replaceFromStore' | 'markDirty'
  >,
  entry: ContentEntryDetail,
  resultingFields: Record<string, unknown> | undefined,
  onStored: OnNoteStored,
): RestoreAdoption {
  const open = doc.docRef.current;
  if (!open || open.id !== entry.id) {
    onStored(
      entry.id,
      entry.revision,
      entry.body,
      resultingFields ?? entry.fields,
    );
    return 'not-open';
  }
  // A restore never changes who can read the note. A server that says what
  // it wrote is taken at its word; otherwise the note keeps its own flag.
  const fields = resultingFields ?? keepDraftState(entry.fields, open.fields);
  onStored(entry.id, entry.revision, entry.body, fields);
  if (doc.hasPendingWrites()) return 'edited-meanwhile';
  doc.replaceFromStore({
    body: entry.body,
    fields: resultingFields ?? entry.fields,
    revision: entry.revision,
  });
  // The store took the version's flag; autosave writes the note's own back.
  if (draftStateOf(fields) !== draftStateOf(resultingFields ?? entry.fields)) {
    doc.markDirty({ fields });
  }
  return 'replaced';
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const isAbort = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'aborted' ||
  (error instanceof DOMException && error.name === 'AbortError');

/**
 * Loads a note's versions while the panel is open, previews the selected one,
 * and restores it. Previews are kept for the life of one opening, so walking
 * up and down the list costs a request per version, once.
 */
export function useStudioHistory({
  open,
  collectionId,
  noteId,
  flush,
  currentRevision,
  blockedReason,
  onRestored,
}: Options) {
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<NoteRevisionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoteRevisionDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cache = useRef(new Map<string, NoteRevisionDetail>());

  // Mirrored so the load effect depends on the panel opening, not on callbacks
  // that change identity with every keystroke in the note behind it.
  const latest = useRef({ flush, currentRevision, blockedReason, onRestored });
  latest.current = { flush, currentRevision, blockedReason, onRestored };

  useEffect(() => {
    if (!open || !collectionId || !noteId) return;
    const controller = new AbortController();
    cache.current.clear();
    setStatus('loading');
    setError('');
    setVersions([]);
    setSelectedId(null);
    setDetail(null);
    setRestoreError('');
    setNow(Date.now());

    (async () => {
      // A failed save does not stop history from opening: the earlier versions
      // are still worth reading, and a restore says for itself if it cannot go.
      await latest.current.flush().catch(() => false);
      const response = await fetchNoteVersions(
        collectionId,
        noteId,
        controller.signal,
      );
      setVersions(response.versions);
      setSelectedId(response.versions[0]?.id ?? null);
      setStatus('ready');
    })().catch((caught) => {
      if (isAbort(caught) || controller.signal.aborted) return;
      setError(messageOf(caught, 'Could not load the history.'));
      setStatus('error');
    });
    return () => controller.abort();
  }, [open, collectionId, noteId, attempt]);

  useEffect(() => {
    if (!open || !collectionId || !selectedId) {
      setDetail(null);
      return;
    }
    const cached = cache.current.get(selectedId);
    setDetailError('');
    if (cached) {
      setDetail(cached);
      return;
    }
    setDetail(null);
    const controller = new AbortController();
    fetchNoteVersion(collectionId, noteId, selectedId, controller.signal)
      .then(({ version }) => {
        cache.current.set(version.id, version);
        setDetail(version);
      })
      .catch((caught) => {
        if (isAbort(caught) || controller.signal.aborted) return;
        setDetailError(messageOf(caught, 'Could not load that version.'));
      });
    return () => controller.abort();
  }, [open, collectionId, noteId, selectedId]);

  const restore = useCallback(async () => {
    if (!collectionId || !selectedId || restoring) return;
    setRestoring(true);
    setRestoreError('');
    try {
      // Said for what it is: "not saved yet" would send the author waiting
      // for a save that cannot happen until they choose.
      const blocked = latest.current.blockedReason();
      if (blocked) throw new Error(blocked);
      if (!(await latest.current.flush())) {
        throw new Error(
          'Your latest changes are not saved yet, so nothing was restored. Try again in a moment.',
        );
      }
      const response: RestoreResponse = await restoreNoteVersion(
        collectionId,
        noteId,
        selectedId,
        latest.current.currentRevision(),
      );
      if (!response.entry) throw new Error('The restore returned no note.');
      latest.current.onRestored(response.entry, response.fields);
    } catch (caught) {
      setRestoreError(messageOf(caught, 'Could not restore that version.'));
    } finally {
      setRestoring(false);
    }
  }, [collectionId, noteId, selectedId, restoring]);

  return {
    status,
    error,
    versions,
    selectedId,
    select: setSelectedId,
    detail,
    detailError,
    restoring,
    restoreError,
    restore,
    retry: () => setAttempt((count) => count + 1),
    now,
  };
}
