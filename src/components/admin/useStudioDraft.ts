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
  /**
   * Why the flag cannot be written right now (a conflict holds saving), or
   * null. The control is disabled with this as its reason.
   */
  blockedReason: string | null;
  notify: (message: string) => void;
  onError: (message: string) => void;
}

export interface StudioDraft {
  /** Null when the open note cannot be unlisted (the Notes root) or none is open. */
  state: DraftState | null;
  /** Shown on the disabled control; null while it can be used. */
  blockedReason: string | null;
  set: (next: DraftState) => void;
  toggle: () => void;
}

function rowWith(
  items: ContentEntryListItem[],
  id: string,
  state: DraftState,
): ContentEntryListItem[] {
  return items.map((item) =>
    item.id === id
      ? { ...item, draft: state === 'draft' ? true : undefined }
      : item,
  );
}

/**
 * The open note's draft flag. The display state comes from the entry list, not
 * from the document ref: a toggle always rewrites the list, which is what
 * re-renders the pill — the ref changes nothing the renderer can see when the
 * note is already marked dirty from typing. Every path that adopts a stored
 * version refreshes the row from the note (`rowPatchFromNote`), so the two
 * agree.
 */
export function useStudioDraft({
  doc,
  openId,
  title,
  entries,
  setEntries,
  blockedReason,
  notify,
  onError,
}: Options): StudioDraft {
  const entry = entries.find((candidate) => candidate.id === openId);
  const toggleable = canToggleDraft(entry);
  const state = toggleable ? draftStateOf(entry) : null;

  const set = useCallback(
    (next: DraftState) => {
      const current = doc.docRef.current;
      if (!current || current.id !== openId || !toggleable) return;
      // Flipping now would show a state that cannot be saved: the control is
      // disabled, and this holds the line for any other way in (the palette).
      if (blockedReason || doc.isPaused()) {
        if (blockedReason) onError(blockedReason);
        return;
      }
      const previous = draftStateOf(current.fields);
      if (previous === next) {
        // The note already says so; only a stale row could have asked.
        setEntries((items) => rowWith(items, openId, next));
        return;
      }
      doc.markDirty({ fields: withDraftState(current.fields, next) });
      setEntries((items) => rowWith(items, openId, next));
      // Visibility is not something to leave to the autosave timer: the
      // writer has just decided who can read this, so the store hears it now,
      // and the confirmation only comes once it has.
      void doc.saveNow().then((saved) => {
        if (saved) {
          notify(draftNotice(title, next));
          return;
        }
        // Not written: put the flag back so the pill, the note and the store
        // agree on who can read it, and say so rather than fail quietly.
        const now = doc.docRef.current;
        if (now?.id === openId && draftStateOf(now.fields) === next) {
          doc.markDirty({ fields: withDraftState(now.fields, previous) });
        }
        setEntries((items) => rowWith(items, openId, previous));
        onError(
          next === 'published'
            ? 'Could not publish — the note is still a draft. Try again in a moment.'
            : 'Could not move the note to drafts — it is still published. Try again in a moment.',
        );
      });
    },
    [
      doc,
      openId,
      toggleable,
      blockedReason,
      setEntries,
      notify,
      onError,
      title,
    ],
  );

  const toggle = useCallback(() => {
    if (state) set(nextDraftState(state));
  }, [state, set]);

  return { state, blockedReason: state ? blockedReason : null, set, toggle };
}
