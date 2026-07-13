import { useCallback, useEffect, useState } from 'preact/hooks';

const MINIMIZED_STORAGE_KEY = 'spotify-widget-minimized';

export function usePersistedMinimized() {
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(MINIMIZED_STORAGE_KEY);
    if (saved) {
      setIsMinimized(saved === 'true');
    }
  }, []);

  const setPersistedMinimized = useCallback((next: boolean) => {
    setIsMinimized(next);
    localStorage.setItem(MINIMIZED_STORAGE_KEY, String(next));
  }, []);

  return { isMinimized, setPersistedMinimized };
}
