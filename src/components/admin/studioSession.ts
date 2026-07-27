// Studio shell preferences: what the workspace looks like when you come back.
// Persisted to localStorage, read after mount so the SSR markup matches the
// first client paint.

export type ViewMode = 'write' | 'split' | 'preview';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type SortMode = 'manual' | 'name' | 'type';

export const STATE_STORAGE_KEY = 'oddava.studio.session';
export const SIDEBAR_BOUNDS = { min: 190, max: 420 } as const;
export const AUTOSAVE_DELAY_MS = 700;
export const MAX_OPEN_TABS = 24;

export interface StudioSession {
  sidebar: number;
  sidebarCollapsed: boolean;
  view: ViewMode;
  lastOpenId: string;
  openIds: string[];
  /** The tab that browsing reuses; '' when every open tab is a deliberate one. */
  previewId: string;
  secondaryId: string;
  expandedFolders: string[];
  autosave: boolean;
  sort: SortMode;
}

export const DEFAULT_SESSION: StudioSession = {
  sidebar: 250,
  sidebarCollapsed: false,
  view: 'write',
  lastOpenId: '',
  openIds: [],
  previewId: '',
  secondaryId: '',
  expandedFolders: [''],
  autosave: true,
  sort: 'manual',
};

export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'split', label: 'Split' },
  { id: 'preview', label: 'Preview' },
];

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
      view: VIEW_MODES.some((mode) => mode.id === parsed.view)
        ? (parsed.view as ViewMode)
        : DEFAULT_SESSION.view,
      lastOpenId:
        typeof parsed.lastOpenId === 'string' ? parsed.lastOpenId : '',
      openIds: Array.isArray(parsed.openIds)
        ? parsed.openIds
            .filter((id) => typeof id === 'string')
            .slice(-MAX_OPEN_TABS)
        : [],
      previewId: typeof parsed.previewId === 'string' ? parsed.previewId : '',
      secondaryId:
        typeof parsed.secondaryId === 'string' ? parsed.secondaryId : '',
      expandedFolders: Array.isArray(parsed.expandedFolders)
        ? parsed.expandedFolders.filter((id) => typeof id === 'string')
        : DEFAULT_SESSION.expandedFolders,
      autosave: parsed.autosave !== false,
      sort: ['manual', 'name', 'type'].includes(parsed.sort ?? '')
        ? (parsed.sort as SortMode)
        : 'manual',
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
