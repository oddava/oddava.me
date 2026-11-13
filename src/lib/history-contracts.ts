/** What Studio and the history routes agree a note's past looks like. */

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
