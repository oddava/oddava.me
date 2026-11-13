/** What Studio and the history routes agree a note's past looks like. */

import type { ContentSaveResponse } from './contracts';

/** `pre-restore` is the state a restore replaced, kept so a restore can be undone. */
export type NoteRevisionReason = 'autosave' | 'pre-restore';

export interface NoteRevisionMeta {
  id: string;
  /** When this content was last saved, i.e. how old this version is. */
  at: string;
  /** When history took the copy (epoch ms). */
  recordedAt: number;
  reason: NoteRevisionReason;
  bytes: number;
}

export interface NoteRevisionDetail extends NoteRevisionMeta {
  fields: Record<string, unknown>;
  body: string;
}

export interface NoteRevisionsResponse {
  versions: NoteRevisionMeta[];
}

export interface NoteRevisionResponse {
  version: NoteRevisionDetail;
}

/**
 * A restore answers like a save, plus the frontmatter it wrote. A restore
 * keeps the note's current `order` and `draft`, so `fields.draft` (absent
 * means published) is what Studio's draft pill should show afterwards.
 */
export interface NoteRestoreResponse extends ContentSaveResponse {
  fields: Record<string, unknown>;
}
