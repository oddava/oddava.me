import { describe, expect, it } from 'vitest';
import {
  canToggleDraft,
  draftNotice,
  draftStateOf,
  keepDraftState,
  NEW_DRAFT_NOTICE,
  NEW_NOTE_FIELDS,
  nextDraftState,
  stepDraftState,
  takeNewDraftNotice,
  withDraftState,
} from '../src/components/admin/studioDraft';

describe('Studio draft state', () => {
  it('reads the state from an entry or its fields, defaulting to published', () => {
    expect(draftStateOf({ draft: true })).toBe('draft');
    expect(draftStateOf({ draft: undefined })).toBe('published');
    expect(draftStateOf({})).toBe('published');
    expect(draftStateOf(undefined)).toBe('published');
  });

  it('writes a draft as draft: true and a published note with no key at all', () => {
    const fields = { icon: '🌱', order: 2 };
    expect(withDraftState(fields, 'draft')).toEqual({
      icon: '🌱',
      order: 2,
      draft: true,
    });
    expect(withDraftState({ ...fields, draft: true }, 'published')).toEqual(
      fields,
    );
    // The caller's object is never mutated: it is the open document's fields.
    expect(fields).toEqual({ icon: '🌱', order: 2 });
  });

  it('starts every Studio-made note as a draft', () => {
    expect(draftStateOf(NEW_NOTE_FIELDS)).toBe('draft');
  });

  it('cannot unlist the Notes root, only the notes inside it', () => {
    expect(canToggleDraft({ id: 'index', folder: '' })).toBe(false);
    expect(canToggleDraft({ id: 'welcome', folder: '' })).toBe(true);
    expect(canToggleDraft({ id: 'index', folder: 'reading' })).toBe(true);
    expect(canToggleDraft(undefined)).toBe(false);
  });

  it('flips between the two states, and arrows stop at either end', () => {
    expect(nextDraftState('draft')).toBe('published');
    expect(nextDraftState('published')).toBe('draft');
    expect(stepDraftState('draft', 1)).toBe('published');
    expect(stepDraftState('published', -1)).toBe('draft');
    // No wrap: an arrow past the end goes nowhere rather than to the other.
    expect(stepDraftState('draft', -1)).toBe('draft');
    expect(stepDraftState('published', 1)).toBe('published');
  });

  it('keeps the note’s own flag over a restored version’s', () => {
    expect(keepDraftState({ icon: 'a' }, { draft: true })).toEqual({
      icon: 'a',
      draft: true,
    });
    expect(keepDraftState({ draft: true, icon: 'a' }, {})).toEqual({
      icon: 'a',
    });
  });

  it('explains new drafts once per browser', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    expect(takeNewDraftNotice(storage)).toBe(NEW_DRAFT_NOTICE);
    expect(takeNewDraftNotice(storage)).toBeNull();
    expect(takeNewDraftNotice(null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(takeNewDraftNotice(broken)).toBeNull();
  });

  it('words the confirmation by direction and keeps long titles short', () => {
    expect(draftNotice('Small discoveries', 'published')).toBe(
      'Published! “Small discoveries” is live for everyone now.',
    );
    expect(draftNotice('Small discoveries', 'draft')).toContain(
      'only you can see it',
    );
    expect(draftNotice('  ', 'published')).toContain('“Your note”');
    const long = draftNotice('x'.repeat(80), 'published');
    expect(long).toContain(`“${'x'.repeat(35)}…”`);
  });
});
