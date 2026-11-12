import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { ROOT_KEY, type TreeRow } from './studioTree';
import {
  findPrefixMatch,
  stepTarget,
  typeAheadBuffer,
} from './studioTreeNavigation';
import type { StudioTreeSelection } from './useStudioTreeSelection';

interface TreeFocusOptions {
  treeRef: RefObject<HTMLDivElement>;
  /** The root row, then every visible row, in screen order. */
  focusOrder: string[];
  rows: TreeRow[];
  rowByKey: Map<string, TreeRow>;
  /** The row holding the file the editor has open, if any. */
  activeKey: string | null;
  searching: boolean;
  selection: StudioTreeSelection;
}

/** The tree's roving tab stop, arrow-key travel, and type-ahead. */
export function useStudioTreeFocus({
  treeRef,
  focusOrder,
  rows,
  rowByKey,
  activeKey,
  searching,
  selection,
}: TreeFocusOptions) {
  const [rovingKey, setRovingKey] = useState<string>(ROOT_KEY);
  const typeAheadRef = useRef({ text: '', at: 0 });

  // Exactly one row is tabbable. Collapsing a branch can take the remembered
  // one off screen, and a tree with no tab stop is a tree Tab skips over.
  const tabbableKey =
    rovingKey === ROOT_KEY || rowByKey.has(rovingKey) ? rovingKey : ROOT_KEY;

  // Opening a file from anywhere else — the palette, a wikilink, a restored
  // session — expands its folders; this is what brings the row into view.
  useEffect(() => {
    if (!activeKey || searching) return;
    findRow(activeKey)?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, rows, searching]);

  function findRow(key: string): HTMLElement | null {
    return (
      treeRef.current?.querySelector<HTMLElement>(
        `[data-tree-key="${key.replaceAll('"', '\\"')}"]`,
      ) ?? null
    );
  }

  function focusRow(key: string) {
    setRovingKey(key);
    const target = findRow(key);
    if (target) target.focus();
    // A row revealed by this very keystroke is not in the DOM yet.
    else requestAnimationFrame(() => findRow(key)?.focus());
  }

  function stepFocus(from: string, offset: number, extend: boolean) {
    const next = stepTarget(focusOrder, from, offset);
    if (!next) return;
    focusRow(next);
    if (!extend) return;
    selection.extendSelection(from, next);
  }

  function jumpToPrefix(character: string, from: string) {
    const now = Date.now();
    const buffer = typeAheadBuffer(typeAheadRef.current, character, now);
    typeAheadRef.current = { text: buffer, at: now };
    const match = findPrefixMatch(focusOrder, rowByKey, buffer, from);
    if (match) focusRow(match);
  }

  return {
    tabbableKey,
    setRovingKey,
    focusRow,
    stepFocus,
    jumpToPrefix,
  };
}

export type StudioTreeFocus = ReturnType<typeof useStudioTreeFocus>;
