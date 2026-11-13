import type { PaletteCommand } from './StudioCommandPalette';
import type { DraftState } from './studioDraft';
import { shortcut as platformShortcut } from './studioHelpers';

/** What the open note's commands do; the workspace owns the doing. */
export interface NoteCommandActions {
  toggleDraft: () => void;
  insertImage: () => void;
  openHistory: () => void;
  outline: () => void;
  find: () => void;
  toggleFocus: () => void;
  toggleTypewriter: () => void;
  save: () => void;
  openPage: () => void;
  deleteNote: () => void;
}

export interface NoteCommandInput {
  /** Null when the note cannot be unlisted (the Notes root). */
  draftState: DraftState | null;
  typewriter: boolean;
  actions: NoteCommandActions;
  /** How this keyboard labels a shortcut; injectable for tests. */
  shortcut?: (key: string, shift?: boolean) => string;
}

/**
 * The palette's commands for the open note, in the order they are listed.
 * Pure: the labels follow the note's state (draft or published, typewriter
 * on or off) and nothing else, so they are tested without a workspace.
 */
export function buildNoteCommands({
  draftState,
  typewriter,
  actions,
  shortcut = platformShortcut,
}: NoteCommandInput): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  if (draftState) {
    commands.push({
      id: 'toggle-draft',
      title: draftState === 'draft' ? 'Publish note' : 'Move note to drafts',
      icon: draftState === 'draft' ? 'eye' : 'eye-off',
      run: actions.toggleDraft,
    });
  }
  commands.push(
    {
      id: 'insert-image',
      title: 'Insert image…',
      icon: 'image',
      run: actions.insertImage,
    },
    {
      id: 'version-history',
      title: 'Version history',
      icon: 'history',
      run: actions.openHistory,
    },
    {
      id: 'outline',
      title: 'Outline',
      icon: 'outline',
      hint: shortcut('O', true),
      run: actions.outline,
    },
    {
      id: 'find-in-note',
      title: 'Find in note',
      icon: 'search',
      hint: shortcut('F'),
      run: actions.find,
    },
    {
      id: 'focus-mode',
      title: 'Focus mode',
      icon: 'focus',
      hint: shortcut('F', true),
      run: actions.toggleFocus,
    },
    {
      id: 'typewriter-scroll',
      title: `Typewriter scroll: ${typewriter ? 'on' : 'off'}`,
      icon: 'focus',
      run: actions.toggleTypewriter,
    },
    {
      id: 'save-note',
      title: 'Save now',
      icon: 'save',
      hint: shortcut('S'),
      run: actions.save,
    },
    {
      id: 'open-browser',
      title: draftState === 'draft' ? 'Preview draft' : 'Open published page',
      icon: 'external',
      run: actions.openPage,
    },
    {
      id: 'delete-note',
      title: 'Delete current note',
      icon: 'trash',
      danger: true,
      run: actions.deleteNote,
    },
  );
  return commands;
}
