const STORAGE_KEY = 'notes-explorer-open';

/** Keep the reader's choice across page loads; leave first-visit defaults alone. */
export function restoreNoteExplorerState(
  details: HTMLDetailsElement,
  compact = false,
): void {
  const storageKey = compact ? `${STORAGE_KEY}-mobile` : STORAGE_KEY;
  if (compact) details.open = false;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'true' || saved === 'false') details.open = saved === 'true';
  } catch {
    // Storage can be disabled; the native disclosure still works.
  }

  let previous = details.open;
  details.addEventListener('toggle', () => {
    // Initial markup and restoration can queue a toggle without user input.
    if (details.open === previous) return;
    previous = details.open;
    try {
      localStorage.setItem(storageKey, String(details.open));
    } catch {
      // A blocked preference write must not interrupt navigation.
    }
  });
}
