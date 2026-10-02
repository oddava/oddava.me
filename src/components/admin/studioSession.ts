// Studio shell preferences: what the workspace looks like when you come back.
// Persisted to localStorage, read after mount so the SSR markup matches the
// first client paint.

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export const STATE_STORAGE_KEY = 'oddava.studio.session';
export const SIDEBAR_BOUNDS = { min: 220, max: 420 } as const;
export const AUTOSAVE_DELAY_MS = 700;
export const MAX_OPEN_TABS = 24;

export interface StudioSession {
  sidebar: number;
  sidebarCollapsed: boolean;
  lastOpenId: string;
  openIds: string[];
  /** The tab that browsing reuses; '' when every open tab is a deliberate one. */
  previewId: string;
  expandedFolders: string[];
}

export const DEFAULT_SESSION: StudioSession = {
  sidebar: 300,
  sidebarCollapsed: false,
  lastOpenId: '',
  openIds: [],
  previewId: '',
  expandedFolders: [''],
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readSession(): StudioSession {
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<StudioSession>;
    return {
      sidebar: clamp(
        Number(parsed.sidebar) || DEFAULT_SESSION.sidebar,
        SIDEBAR_BOUNDS.min,
        SIDEBAR_BOUNDS.max,
      ),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      lastOpenId:
        typeof parsed.lastOpenId === 'string' ? parsed.lastOpenId : '',
      openIds: Array.isArray(parsed.openIds)
        ? parsed.openIds
            .filter((id) => typeof id === 'string')
            .slice(-MAX_OPEN_TABS)
        : [],
      previewId: typeof parsed.previewId === 'string' ? parsed.previewId : '',
      expandedFolders: Array.isArray(parsed.expandedFolders)
        ? parsed.expandedFolders.filter((id) => typeof id === 'string')
        : DEFAULT_SESSION.expandedFolders,
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

export function writeSession(session: StudioSession): void {
  try {
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing or a full quota — session just won't persist.
  }
}
