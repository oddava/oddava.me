import { useCallback, useRef, useState } from 'preact/hooks';
import {
  EMPTY_STRIP,
  closeInStrip,
  normalizeStrip,
  openInStrip,
  renameInStrip,
  type OpenInStripOptions,
  type TabStrip,
} from './studioTabStrip';

export interface StudioTabs {
  openIds: string[];
  /** The tab browsing reuses, so clicking through files stacks nothing up. */
  previewId: string;
  /** Put `id` in the strip: reusing the preview tab, or claiming one for good. */
  addTab: (id: string, options?: OpenInStripOptions) => void;
  /** Drop `id` from the strip. */
  forgetTab: (id: string) => void;
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

  const addTab = useCallback((id: string, options: OpenInStripOptions = {}) => {
    setStrip((current) => openInStrip(current, id, options));
  }, []);

  const forgetTab = useCallback((id: string) => {
    setStrip((current) => closeInStrip(current, id));
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
  }, []);

  const stepHistory = useCallback(
    (direction: -1 | 1, exists: (id: string) => boolean) => {
      const nextIndex = historyIndexRef.current + direction;
      const id = historyRef.current[nextIndex];
      if (!id || !exists(id)) return null;
      historyIndexRef.current = nextIndex;
      return id;
    },
    [],
  );

  return {
    openIds: strip.openIds,
    previewId: strip.previewId,
    addTab,
    forgetTab,
    restoreTabs,
    renameTab,
    rememberHistory,
    stepHistory,
  };
}
