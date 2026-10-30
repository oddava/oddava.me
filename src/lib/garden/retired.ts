import { followNoteRedirect } from '../server/content/note-archive';
import type { RetiredNoteIndex } from '../server/content/note-archive';
import { noteIdFromSourceId } from './utils';

export interface PublicNoteRef {
  path: string;
  sourceId: string;
  href: string;
}

export type PublicNoteDecision =
  | { kind: 'document' }
  | { kind: 'redirect'; href: string }
  | { kind: 'gone' }
  | { kind: 'missing' };

/**
 * What the public notes route should do with a path.
 *
 * A live note wins. A tombstone, including one at the end of a rename chain,
 * is gone. A chain of renames resolves to the note that exists now, as one
 * hop. The bare-filename alias stays last so a removed note is not silently
 * replaced by a different note that happens to share its file name.
 */
export function decidePublicNote(
  requestedPath: string,
  documents: readonly PublicNoteRef[],
  retired: RetiredNoteIndex,
): PublicNoteDecision {
  if (documents.some((document) => document.path === requestedPath)) {
    return { kind: 'document' };
  }
  if (retired.tombstones.has(requestedPath)) return { kind: 'gone' };

  const followed = followNoteRedirect(requestedPath, retired.redirects);
  if (retired.tombstones.has(followed.path)) return { kind: 'gone' };
  if (!followed.cycle && followed.hopped) {
    const destination = documents.find(
      (document) => document.path === followed.path,
    );
    if (destination) return { kind: 'redirect', href: destination.href };
  }

  const aliases = documents.filter(
    (document) =>
      document.path && noteIdFromSourceId(document.sourceId) === requestedPath,
  );
  if (aliases.length === 1) return { kind: 'redirect', href: aliases[0]!.href };
  return { kind: 'missing' };
}
