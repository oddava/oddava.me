import { describe, expect, it, vi } from 'vitest';
import {
  buildNoteCommands,
  type NoteCommandActions,
} from '../src/components/admin/studioPaletteCommands';

function actions(): NoteCommandActions {
  return {
    toggleDraft: vi.fn(),
    insertImage: vi.fn(),
    openHistory: vi.fn(),
    outline: vi.fn(),
    find: vi.fn(),
    toggleFocus: vi.fn(),
    toggleTypewriter: vi.fn(),
    pageStyle: vi.fn(),
    save: vi.fn(),
    openPage: vi.fn(),
    deleteNote: vi.fn(),
  };
}

const shortcut = (key: string, shift = false) =>
  `Ctrl+${shift ? 'Shift+' : ''}${key}`;

const build = (
  overrides: Partial<Parameters<typeof buildNoteCommands>[0]> = {},
) =>
  buildNoteCommands({
    draftState: 'published',
    typewriter: false,
    actions: actions(),
    shortcut,
    ...overrides,
  });

describe('buildNoteCommands', () => {
  it('lists the open note’s commands in order', () => {
    expect(build().map((command) => command.id)).toEqual([
      'toggle-draft',
      'insert-image',
      'version-history',
      'outline',
      'find-in-note',
      'focus-mode',
      'typewriter-scroll',
      'page-style',
      'save-note',
      'open-browser',
      'delete-note',
    ]);
  });

  it('words the draft commands by the note’s state', () => {
    const published = build({ draftState: 'published' });
    expect(published[0]).toMatchObject({
      title: 'Move note to drafts',
      icon: 'eye-off',
    });
    expect(published.find((c) => c.id === 'open-browser')?.title).toBe(
      'Open published page',
    );

    const draft = build({ draftState: 'draft' });
    expect(draft[0]).toMatchObject({ title: 'Publish note', icon: 'eye' });
    expect(draft.find((c) => c.id === 'open-browser')?.title).toBe(
      'Preview draft',
    );
  });

  it('has no draft command for a note that cannot be unlisted', () => {
    const commands = build({ draftState: null });
    expect(commands.some((c) => c.id === 'toggle-draft')).toBe(false);
    expect(commands.find((c) => c.id === 'open-browser')?.title).toBe(
      'Open published page',
    );
  });

  it('says whether typewriter scroll is on', () => {
    const title = (typewriter: boolean) =>
      build({ typewriter }).find((c) => c.id === 'typewriter-scroll')?.title;
    expect(title(true)).toBe('Typewriter scroll: on');
    expect(title(false)).toBe('Typewriter scroll: off');
  });

  it('shows the shortcut beside the commands that have one', () => {
    const hints = Object.fromEntries(
      build().map((command) => [command.id, command.hint]),
    );
    expect(hints).toMatchObject({
      outline: 'Ctrl+Shift+O',
      'find-in-note': 'Ctrl+F',
      'focus-mode': 'Ctrl+Shift+F',
      'save-note': 'Ctrl+S',
    });
    expect(hints['delete-note']).toBeUndefined();
  });

  it('runs the action it names', () => {
    const handlers = actions();
    const commands = build({ actions: handlers });
    commands.find((c) => c.id === 'version-history')!.run();
    commands.find((c) => c.id === 'delete-note')!.run();
    expect(handlers.openHistory).toHaveBeenCalledOnce();
    expect(handlers.deleteNote).toHaveBeenCalledOnce();
    expect(commands.find((c) => c.id === 'delete-note')?.danger).toBe(true);
  });
});
