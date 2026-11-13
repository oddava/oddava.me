export type { AffinityEdge, GardenDocument, GardenIndex } from './types';
export {
  GardenUnavailableError,
  GardenEmptyError,
  GardenBusyError,
} from './errors';
export {
  getGardenIndexOrUnavailable,
  readPublicNoteRetirement,
  type GardenIndexOptions,
  type GardenIndexResult,
} from './runtime';
export { isDraftNote } from '../content/noteDraft';
export { decidePublicNote, type PublicNoteDecision } from './retired';
export {
  buildAffinityPaths,
  getRelatedNotes,
  findNoteLeafRedirect,
} from './relationships';
export {
  getNoteTags,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  uniqueNoteLeafRedirects,
} from './utils';
export {
  normalizeQuery,
  searchNotes,
  searchExcerpt,
  scoreNote,
  type SearchableNote,
} from './search';
