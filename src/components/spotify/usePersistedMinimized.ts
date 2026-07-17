import { useCallback, useState } from 'preact/hooks';
import {
  MINIMIZED_STORAGE_KEY,
  MOBILE_MINIMIZE_QUERY,
  resolveInitialMinimized,
} from './minimizedState';

function readInitialMinimized(): boolean {
  // The widget is client:only, so window exists here; storage or matchMedia
  // can still throw (privacy modes), in which case fall back to expanded.
  try {
    return resolveInitialMinimized(
      localStorage.getItem(MINIMIZED_STORAGE_KEY),
      window.matchMedia(MOBILE_MINIMIZE_QUERY).matches,
    );
  } catch {
    return false;
  }
}

export function usePersistedMinimized() {
  // Lazy initializer: reading the persisted value before first paint avoids
  // flashing the expanded card and collapsing it a frame later.
  const [isMinimized, setIsMinimized] = useState(readInitialMinimized);

  const setPersistedMinimized = useCallback((next: boolean) => {
    setIsMinimized(next);
    try {
      localStorage.setItem(MINIMIZED_STORAGE_KEY, String(next));
    } catch {
      // Best-effort persistence; the in-memory state still updates.
    }
  }, []);

  return { isMinimized, setPersistedMinimized };
}
