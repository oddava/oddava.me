import { describe, expect, it } from 'vitest';
import {
  canToggleDraft,
  draftNotice,
  draftStateOf,
  NEW_NOTE_FIELDS,
  nextDraftState,
  stepDraftState,
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

  it('flips and steps between the two states, wrapping like a radio group', () => {
    expect(nextDraftState('draft')).toBe('published');
    expect(nextDraftState('published')).toBe('draft');
    expect(stepDraftState('draft', 1)).toBe('published');
    expect(stepDraftState('draft', -1)).toBe('published');
    expect(stepDraftState('published', 1)).toBe('draft');
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
