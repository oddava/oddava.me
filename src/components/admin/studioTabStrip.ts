// What opening a file does to the strip of open tabs. Pure, so the rules are
// testable without a DOM — `useStudioTabs` is a thin wrapper around them.

import { MAX_OPEN_TABS } from './studioSession';

/**
 * Browsing the tree opens files as 'preview': they all share one reusable tab,
 * so clicking through a folder no longer leaves a trail of tabs behind. Every
 * deliberate gesture — open in new tab, a drop on the strip, a file you just
 * created — asks for 'permanent' and gets a tab of its own.
 */
export type TabPlacement = 'preview' | 'permanent';

export interface TabStrip {
  openIds: string[];
  /** The reusable tab, or '' when every open tab was opened deliberately. */
  previewId: string;
}

export interface OpenInStripOptions {
  placement?: TabPlacement;
  /** Where a dropped tab lands. Appended when absent. */
  index?: number;
}

export const EMPTY_STRIP: TabStrip = { openIds: [], previewId: '' };

/** Insert `id`, trimming the oldest tabs — never the one just opened. */
function insertTab(openIds: string[], id: string, index?: number): string[] {
  const slot =
    index === undefined
      ? openIds.length
      : Math.max(0, Math.min(index, openIds.length));
  const next = [...openIds];
  next.splice(slot, 0, id);
  let overflow = next.length - MAX_OPEN_TABS;
  if (overflow <= 0) return next;
  return next.filter((candidate) => {
    if (overflow > 0 && candidate !== id) {
      overflow -= 1;
      return false;
    }
    return true;
  });
}

export function openInStrip(
  strip: TabStrip,
  id: string,
  options: OpenInStripOptions = {},
): TabStrip {
  const { placement = 'preview', index } = options;
  const isOpen = strip.openIds.includes(id);

  if (placement === 'permanent') {
    return {
      openIds: isOpen ? strip.openIds : insertTab(strip.openIds, id, index),
      // The file now has a tab of its own, so nothing is reusing that slot.
      previewId: strip.previewId === id ? '' : strip.previewId,
    };
  }

  // An open file keeps the tab it already has, and keeps whatever that tab is:
  // clicking a permanent tab must not quietly turn it back into the preview.
  if (isOpen) return strip;

  const slot = strip.previewId ? strip.openIds.indexOf(strip.previewId) : -1;
  if (slot < 0) {
    return { openIds: insertTab(strip.openIds, id, index), previewId: id };
  }
  const openIds = [...strip.openIds];
  openIds[slot] = id;
  return { openIds, previewId: id };
}

export function closeInStrip(strip: TabStrip, id: string): TabStrip {
  if (!strip.openIds.includes(id)) return strip;
  return {
    openIds: strip.openIds.filter((candidate) => candidate !== id),
    previewId: strip.previewId === id ? '' : strip.previewId,
  };
}

/** Keep only `keepIds` — what "close others" and "close all" leave behind. */
export function retainInStrip(strip: TabStrip, keepIds: string[]): TabStrip {
  const keep = new Set(keepIds);
  return {
    openIds: strip.openIds.filter((id) => keep.has(id)),
    previewId: keep.has(strip.previewId) ? strip.previewId : '',
  };
}

export function renameInStrip(
  strip: TabStrip,
  from: string,
  to: string,
): TabStrip {
  if (!strip.openIds.includes(from)) return strip;
  return {
    openIds: strip.openIds.map((id) => (id === from ? to : id)),
    previewId: strip.previewId === from ? to : strip.previewId,
  };
}

/** A restored session may name tabs that no longer exist; drop the strays. */
export function normalizeStrip(strip: TabStrip): TabStrip {
  return {
    openIds: strip.openIds,
    previewId: strip.openIds.includes(strip.previewId) ? strip.previewId : '',
  };
}
