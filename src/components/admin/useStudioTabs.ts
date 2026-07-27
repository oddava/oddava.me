import { useCallback, useRef, useState } from 'preact/hooks';
import {
  EMPTY_STRIP,
  closeInStrip,
  normalizeStrip,
  openInStrip,
  renameInStrip,
  retainInStrip,
  type OpenInStripOptions,
  type TabStrip,
} from './studioTabStrip';

export interface StudioTabs {
  openIds: string[];
  /** The tab browsing reuses, so clicking through files stacks nothing up. */
  previewId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Put `id` in the strip: reusing the preview tab, or claiming one for good. */
  addTab: (id: string, options?: OpenInStripOptions) => void;
  /** Promote the preview tab so browsing stops reusing it. */
  pinTab: (id: string) => void;
  /** Drop `id` from the strip. */
  forgetTab: (id: string) => void;
  /** Keep only these tabs — "close others" and "close all". */
  retainTabs: (keepIds: string[]) => void;
  /** New tab order after a drag along the strip. */
  reorderTabs: (ids: string[]) => void;
  /** Hand the strip back its saved state, minus anything that no longer exists. */
  restoreTabs: (strip: TabStrip) => void;
  /** Follow a rename through the strip and through history. */
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

/** The open-file strip and back/forward history. */
export function useStudioTabs(): StudioTabs {
  const [strip, setStrip] = useState<TabStrip>(EMPTY_STRIP);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [historyVersion, setHistoryVersion] = useState(0);

  const addTab = useCallback((id: string, options: OpenInStripOptions = {}) => {
    setStrip((current) => openInStrip(current, id, options));
  }, []);

  const pinTab = useCallback((id: string) => {
    setStrip((current) =>
      current.previewId === id ? { ...current, previewId: '' } : current,
    );
  }, []);

  const forgetTab = useCallback((id: string) => {
    setStrip((current) => closeInStrip(current, id));
  }, []);

  const retainTabs = useCallback((keepIds: string[]) => {
    setStrip((current) => retainInStrip(current, keepIds));
  }, []);

  const reorderTabs = useCallback((ids: string[]) => {
    setStrip((current) => normalizeStrip({ ...current, openIds: ids }));
  }, []);

  const restoreTabs = useCallback((next: TabStrip) => {
    setStrip(normalizeStrip(next));
  }, []);

  const renameTab = useCallback((from: string, to: string) => {
    setStrip((current) => renameInStrip(current, from, to));
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
    openIds: strip.openIds,
    previewId: strip.previewId,
    canGoBack: historyIndexRef.current > 0,
    canGoForward:
      historyIndexRef.current >= 0 &&
      historyIndexRef.current < historyRef.current.length - 1,
    addTab,
    pinTab,
    forgetTab,
    retainTabs,
    reorderTabs,
    restoreTabs,
    renameTab,
    rememberHistory,
    stepHistory,
  };
}
