import { isDraftNote } from '../content/noteDraft';
import type { NoteSource } from './types';
import { notePathFromSourceId } from './utils';

function isRootNote(source: Pick<NoteSource, 'id'>): boolean {
  return notePathFromSourceId(source.id) === '';
}

/**
 * The one place drafts leave the garden. Filtering the *sources*, before the
 * index is built, means hierarchy, backlinks, tags, search, the graph, the
 * wikilink lookup and affinity edges are all derived from public notes only —
 * there is no per-surface check to forget, and a link to a draft simply fails
 * to resolve instead of leaking its title or href.
 *
 * The Notes root is exempt: the garden cannot be built without it, and the
 * front door cannot be unlisted.
 */
export function publicNoteSources(sources: NoteSource[]): NoteSource[] {
  return sources.filter(
    (source) => isRootNote(source) || !isDraftNote(source.data),
  );
}

export function hasDrafts(sources: readonly NoteSource[]): boolean {
  return sources.some(
    (source) => !isRootNote(source) && isDraftNote(source.data),
  );
}
