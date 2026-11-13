import type { NoteArchiveOps } from './note-archive';
import { entryIdFromPath } from './paths';
import { NOTES_COLLECTION } from './registry';
import { createNoteRevisionStore } from './revisions-store';
import type { NoteRevisionStore } from './revisions-store';
import type { ContentProvider } from './types';

/** The note id a store path names, or null for anything that is not a note. */
export function noteIdFromPath(path: string): string | null {
  if (!path.startsWith(`${NOTES_COLLECTION.sourceDir}/`)) return null;
  const extension = NOTES_COLLECTION.readExtensions.find((candidate) =>
    path.toLowerCase().endsWith(`.${candidate}`),
  );
  return extension
    ? entryIdFromPath(path, NOTES_COLLECTION.readExtensions)
    : null;
}

/**
 * History is a courtesy to the author, never a precondition of saving: a store
 * hiccup here must not turn a good write into a failed one. The mutation lock
 * the callers already hold is what makes "record, then write" safe to order.
 */
async function bestEffort(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error('[content] Note history could not be updated.', error);
  }
}

/**
 * Wraps a content provider so the write path keeps note history without its
 * handlers knowing: an update first records the note it is about to replace,
 * a rename carries the history to the new id, and a permanent delete drops it.
 * Folder moves change no id, so they need nothing.
 */
export function withNoteRevisions<T extends ContentProvider>(
  store: T,
  revisions: NoteRevisionStore = createNoteRevisionStore(),
): T {
  function carryHistory(fromPath: string, toPath: string): Promise<void> {
    const from = noteIdFromPath(fromPath);
    const to = noteIdFromPath(toPath);
    if (!from || !to) return Promise.resolve();
    return bestEffort(() => revisions.rename(from, to));
  }

  function dropHistory(path: string): Promise<void> {
    const id = noteIdFromPath(path);
    return id ? bestEffort(() => revisions.drop(id)) : Promise.resolve();
  }

  const overrides: Partial<ContentProvider & NoteArchiveOps> = {
    async writeTextFile(path, content, message, revision) {
      const id = noteIdFromPath(path);
      if (id && revision) {
        await bestEffort(() =>
          revisions.snapshot({
            id,
            filePath: path,
            expectedRevision: revision,
          }),
        );
      }
      return store.writeTextFile(path, content, message, revision);
    },

    async moveFile(from, to, message, revision) {
      const result = await store.moveFile(from, to, message, revision);
      await carryHistory(from, to);
      return result;
    },

    async moveDirectory(from, to, message, linkedFile) {
      const result = await store.moveDirectory(from, to, message, linkedFile);
      if (linkedFile) await carryHistory(linkedFile.from, linkedFile.to);
      return result;
    },

    async deleteFile(path, message, revision) {
      const result = await store.deleteFile(path, message, revision);
      await dropHistory(path);
      return result;
    },

    async deleteDirectory(path, message, linkedFile) {
      const result = await store.deleteDirectory(path, message, linkedFile);
      if (linkedFile) await dropHistory(linkedFile.path);
      return result;
    },
  };

  // The notes API's rename lives beside these on the same object; only a
  // rename moves an id, trashing keeps the history for a restore.
  const { moveArchivedNote } = store as Partial<
    Pick<NoteArchiveOps, 'moveArchivedNote'>
  >;
  if (moveArchivedNote) {
    const override: NoteArchiveOps['moveArchivedNote'] = async (input) => {
      const result = await moveArchivedNote.call(store, input);
      await carryHistory(input.fromStorePath, input.toStorePath);
      return result;
    };
    overrides.moveArchivedNote = override;
  }

  // A proxy rather than a spread: stores are sometimes class instances whose
  // methods live on the prototype, and a spread would silently drop them.
  return new Proxy(store, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return overrides[property as keyof typeof overrides];
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
