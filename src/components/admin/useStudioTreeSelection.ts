import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import { keyToItem } from './studioTree';

/**
 * The Notes tree's multi-selection: ctrl-click toggles, shift-click and
 * shift-arrows extend a range from the anchor, and a bulk action that
 * succeeds clears it.
 */
export function useStudioTreeSelection(
  folders: ContentFolder[],
  entries: ContentEntryListItem[],
  rowKeys: string[],
) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // A deleted or renamed item must not linger in the selection.
  useEffect(() => {
    setSelectedKeys((current) => {
      const live = current.filter((key) => {
        const item = keyToItem(key);
        return item.kind === 'folder'
          ? folders.some((folder) => folder.id === item.id)
          : entries.some((entry) => entry.id === item.id);
      });
      return live.length === current.length ? current : live;
    });
  }, [entries, folders]);

  const selectedItems = useMemo(
    () => selectedKeys.map(keyToItem),
    [selectedKeys],
  );

  function clearSelection() {
    setSelectedKeys([]);
    setAnchorKey(null);
  }

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
    setAnchorKey(key);
  }

  function selectRange(from: string, to: string) {
    const start = rowKeys.indexOf(from);
    const end = rowKeys.indexOf(to);
    if (start < 0 || end < 0) {
      setSelectedKeys([to]);
      return;
    }
    const [low, high] = start <= end ? [start, end] : [end, start];
    setSelectedKeys(rowKeys.slice(low, high + 1));
  }

  /** Shift-arrows: grow the range from the anchor (or `from`) to `to`. */
  function extendSelection(from: string, to: string) {
    const anchor = anchorKey ?? from;
    setAnchorKey(anchor);
    selectRange(anchor, to);
  }

  function selectAll() {
    setSelectedKeys(rowKeys);
    setAnchorKey(rowKeys[0] ?? null);
  }

  /**
   * Returns true when the click was a selection gesture and the row should not
   * also be opened.
   */
  function handleSelectionClick(event: MouseEvent, key: string): boolean {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(key);
      return true;
    }
    if (event.shiftKey && anchorKey) {
      selectRange(anchorKey, key);
      return true;
    }
    clearSelection();
    setAnchorKey(key);
    return false;
  }

  async function runBulk(action: () => Promise<boolean>) {
    setBulkBusy(true);
    const ok = await action();
    setBulkBusy(false);
    if (ok) clearSelection();
  }

  return {
    selectedKeys,
    selectedItems,
    bulkBusy,
    clearSelection,
    toggleSelection,
    extendSelection,
    selectAll,
    handleSelectionClick,
    runBulk,
  };
}

export type StudioTreeSelection = ReturnType<typeof useStudioTreeSelection>;
