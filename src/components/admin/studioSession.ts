// Studio shell preferences: what the workspace looks like when you come back.
// Persisted to localStorage, read after mount so the SSR markup matches the
// first client paint.

// Three ways to look at a note, and no fourth: Visual is the editor, Markdown
// is the source, Preview is the published page. The old permanent Split view is
// gone — Visual already shows rendered Markdown, so a second pane showing the
// same thing cost half the writing width to say it twice.
export type ViewMode = 'visual' | 'markdown' | 'preview';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

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
  expandedFolders: string[];
  autosave: boolean;
  /** Dim the workspace around the note and widen the writing column. */
  focusMode: boolean;
}

export const DEFAULT_SESSION: StudioSession = {
  sidebar: 280,
  sidebarCollapsed: false,
  view: 'visual',
  lastOpenId: '',
  openIds: [],
  previewId: '',
  expandedFolders: [''],
  autosave: true,
  focusMode: false,
};

export const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'visual', label: 'Visual', hint: 'Write in the rendered document' },
  { id: 'markdown', label: 'Markdown', hint: 'Edit the raw source' },
  { id: 'preview', label: 'Preview', hint: 'The published page' },
];

/**
 * A stored view, migrated. `write` and `split` were the two halves of the old
 * side-by-side editor; both are what Visual replaced, so a returning session
 * lands there rather than on a mode that no longer exists.
 */
export function normalizeView(value: unknown): ViewMode {
  if (value === 'preview') return 'preview';
  if (value === 'markdown') return 'markdown';
  return 'visual';
}

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
      view: normalizeView(parsed.view),
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
      autosave: parsed.autosave !== false,
      focusMode: parsed.focusMode === true,
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
