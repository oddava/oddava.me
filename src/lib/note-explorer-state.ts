const STORAGE_KEY = 'notes-explorer-open';

/** Keep the reader's choice across page loads; leave first-visit defaults alone. */
export function restoreNoteExplorerState(details: HTMLDetailsElement): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, String(details.open));
    } catch {
      // A blocked preference write must not interrupt navigation.
    }
  });
}
