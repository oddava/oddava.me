import { useCallback } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { ContentEntryListItem } from '../../lib/contracts';
import type { StudioDocument } from './useStudioDocument';
import {
  canToggleDraft,
  draftNotice,
  draftStateOf,
  nextDraftState,
  withDraftState,
  type DraftState,
} from './studioDraft';

interface Options {
  doc: StudioDocument;
  openId: string;
  title: string;
  entries: ContentEntryListItem[];
  setEntries: Dispatch<StateUpdater<ContentEntryListItem[]>>;
  notify: (message: string) => void;
}

export interface StudioDraft {
  /** Null when the open note cannot be unlisted (the Notes root) or none is open. */
  state: DraftState | null;
  set: (next: DraftState) => void;
  toggle: () => void;
}

/**
 * The open note's draft flag. The display state comes from the entry list, not
 * from the document ref: a toggle always rewrites the list, which is what
 * re-renders the pill — the ref changes nothing the renderer can see when the
 * note is already marked dirty from typing.
 */
export function useStudioDraft({
  doc,
  openId,
  title,
  entries,
  setEntries,
  notify,
}: Options): StudioDraft {
  const entry = entries.find((candidate) => candidate.id === openId);
  const toggleable = canToggleDraft(entry);
  const state = toggleable ? draftStateOf(entry) : null;

  const set = useCallback(
    (next: DraftState) => {
      const current = doc.docRef.current;
      if (!current || current.id !== openId || !toggleable) return;
      if (draftStateOf(current.fields) === next) return;
      doc.markDirty({ fields: withDraftState(current.fields, next) });
      setEntries((items) =>
        items.map((item) =>
          item.id === openId
            ? { ...item, draft: next === 'draft' ? true : undefined }
            : item,
        ),
      );
      // Visibility is not something to leave to the autosave timer: the
      // writer has just decided who can read this, so the store hears it now,
      // and the confirmation only comes once it has.
      void doc.saveNow().then((saved) => {
        if (saved) notify(draftNotice(title, next));
      });
    },
    [doc, openId, toggleable, setEntries, notify, title],
  );

  const toggle = useCallback(() => {
    if (state) set(nextDraftState(state));
  }, [state, set]);

  return { state, set, toggle };
}
