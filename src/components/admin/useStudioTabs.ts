import { useCallback, useRef, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import { MAX_OPEN_TABS, type SaveState } from './studioSession';

export interface StudioTabs {
  openIds: string[];
  setOpenIds: Dispatch<StateUpdater<string[]>>;
  secondaryId: string;
  setSecondaryId: Dispatch<StateUpdater<string>>;
  secondaryState: SaveState;
  setSecondaryState: Dispatch<StateUpdater<SaveState>>;
  /** The second editor holds edits the store does not have yet. */
  secondaryDirty: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Add `id` to the open strip if it isn't there already. */
  addTab: (id: string) => void;
  /** Drop `id` from the strip, and from the second editor if it sat there. */
  forgetTab: (id: string) => void;
  /** Follow a rename through the strip, the second editor and history. */
  renameTab: (from: string, to: string) => void;
  rememberHistory: (id: string) => void;
  /**
   * Walk history by `direction`, skipping entries that no longer exist.
   * Commits the new position and returns the id to open, or null.
   */
  stepHistory: (
    direction: -1 | 1,
    exists: (id: string) => boolean,
  ) => string | null;
}

/** The open-file strip, the second editor slot, and back/forward history. */
export function useStudioTabs(): StudioTabs {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [secondaryId, setSecondaryId] = useState('');
  const [secondaryState, setSecondaryState] = useState<SaveState>('idle');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [historyVersion, setHistoryVersion] = useState(0);

  const addTab = useCallback((id: string) => {
    setOpenIds((current) =>
      current.includes(id) ? current : [...current, id].slice(-MAX_OPEN_TABS),
    );
  }, []);

  const forgetTab = useCallback((id: string) => {
    setOpenIds((current) => current.filter((candidate) => candidate !== id));
    setSecondaryId((current) => (current === id ? '' : current));
  }, []);

  const renameTab = useCallback((from: string, to: string) => {
    setOpenIds((current) => current.map((id) => (id === from ? to : id)));
    setSecondaryId((current) => (current === from ? to : current));
    historyRef.current = historyRef.current.map((id) =>
      id === from ? to : id,
    );
  }, []);

  const rememberHistory = useCallback((id: string) => {
    const current = historyRef.current[historyIndexRef.current];
    if (current === id) return;
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(id);
    historyRef.current = next.slice(-80);
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion((value) => value + 1);
  }, []);

  const stepHistory = useCallback(
    (direction: -1 | 1, exists: (id: string) => boolean) => {
      const nextIndex = historyIndexRef.current + direction;
      const id = historyRef.current[nextIndex];
      if (!id || !exists(id)) return null;
      historyIndexRef.current = nextIndex;
      setHistoryVersion((value) => value + 1);
      return id;
    },
    [],
  );

  // Read so the arrows re-render when history moves; the stacks are refs.
  void historyVersion;

  return {
    openIds,
    setOpenIds,
    secondaryId,
    setSecondaryId,
    secondaryState,
    setSecondaryState,
    secondaryDirty:
      secondaryState === 'dirty' ||
      secondaryState === 'saving' ||
      secondaryState === 'error',
    canGoBack: historyIndexRef.current > 0,
    canGoForward:
      historyIndexRef.current >= 0 &&
      historyIndexRef.current < historyRef.current.length - 1,
    addTab,
    forgetTab,
    renameTab,
    rememberHistory,
    stepHistory,
  };
}
