import { currentNotesBase } from '../notes-url';
import { parseDraftFlag } from '../content/noteDraft';
import { noteDataSchema } from '../content/schemas';
import {
  parseContentDocument,
  readRedisNoteFiles,
  readRetiredNoteIndex,
  readStableContentVersion,
} from '../server/content';
import { delay, isStorageUnavailableError } from '../server/core';
import type { RetiredNoteIndex } from '../server/content/note-archive';
import { buildGardenIndex } from './build';
import {
  GardenBusyError,
  GardenOutdatedError,
  GardenUnavailableError,
} from './errors';
import type { GardenIndex, NoteSource } from './types';
import { hasDrafts, publicNoteSources } from './visibility';

async function loadNoteSources(): Promise<NoteSource[]> {
  return (await readRedisNoteFiles()).map((file) => {
    const document = parseContentDocument(file.content);
    if (document.frontmatterError) {
      console.warn(
        `[garden] Unparseable frontmatter for note "${file.sourceId}"; keeping it unlisted until it is repaired.`,
      );
      return {
        id: file.sourceId,
        data: { draft: true },
        body: document.body,
        updatedAt: file.updatedAt,
      };
    }
    // Field-level validation failures (a hand-edited `order: 1.5`, an
    // unparseable `updated`) degrade this one note to defaults rather than
    // throwing out of the shared index build and 500-ing the whole garden.
    const parsed = noteDataSchema.safeParse(document.fields);
    if (!parsed.success) {
      console.warn(
        `[garden] Ignoring invalid frontmatter for note "${file.sourceId}".`,
        parsed.error.issues,
      );
    }
    return {
      id: file.sourceId,
      // A note that fails validation must still keep its draft flag: falling
      // back to bare defaults would publish a half-written note because of an
      // unrelated typo in its frontmatter.
      data: parsed.success
        ? parsed.data
        : parseDraftFlag(document.fields.draft)
          ? { draft: true }
          : {},
      body: document.body,
      updatedAt: file.updatedAt,
    };
  });
}

// One index per notes base: every href in it is built with the base of the
// request that built it, and the notes host links root-relative while the
// apex links under `/notes`. Both audiences are built from the same stable
// snapshot so a version never pairs a public index with a newer owner one;
// with no drafts they are the same object.
interface CachedGardenIndexes {
  version: string;
  index: GardenIndex;
  ownerIndex: GardenIndex;
}

const cachedGardenIndexes = new Map<string, CachedGardenIndexes>();

function buildAudienceIndexes(
  sources: NoteSource[],
): Pick<CachedGardenIndexes, 'index' | 'ownerIndex'> {
  const index = buildGardenIndex(publicNoteSources(sources));
  return {
    index,
    ownerIndex: hasDrafts(sources) ? buildGardenIndex(sources) : index,
  };
}

export interface GardenIndexOptions {
  /**
   * Drafts are in the owner's index only. Pass this solely from a route that
   * has already proved an admin session (or is itself admin-only); every
   * public surface takes the default.
   */
  includeDrafts?: boolean;
}

const STABLE_READ_ATTEMPTS = 20;
const STABLE_READ_RETRY_MS = 100;

export async function readPublicNoteRetirement(): Promise<
  { ok: true; retired: RetiredNoteIndex } | { ok: false }
> {
  try {
    const retired = await readRetiredNoteIndex();
    if (!retired) return { ok: false };
    return { ok: true, retired };
  } catch (error) {
    if (isStorageUnavailableError(error)) return { ok: false };
    throw error;
  }
}

export async function getGardenIndex({
  includeDrafts = false,
}: GardenIndexOptions = {}): Promise<GardenIndex> {
  const base = currentNotesBase();
  const cachedGardenIndex = cachedGardenIndexes.get(base);
  const pick = (cached: CachedGardenIndexes): GardenIndex =>
    includeDrafts ? cached.ownerIndex : cached.index;
  // The index must be built from one stable snapshot. The mutation
  // lock covers compound Studio operations; checking the version again after
  // the build also catches a write that began between the first check and the
  // file reads. Only plain data is cached globally—never request-bound I/O.
  //
  // The cache is a fallback only until a newer version has been seen. Before
  // that it may well be current (the store is unreachable, or a mutation holds
  // the lock), and serving it beats a 503. After it, the cache is known to be
  // outdated, and an outdated public index can still list a note that has
  // since been withdrawn (marked draft, trashed): it fails closed instead.
  let outdated = false;
  const fallback = (error?: unknown): GardenIndex => {
    if (cachedGardenIndex && !outdated) return pick(cachedGardenIndex);
    if (outdated) throw new GardenOutdatedError({ cause: error });
    throw error;
  };
  for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt += 1) {
    let version: string | null;
    try {
      version = await readStableContentVersion();
    } catch (error) {
      return fallback(error);
    }
    if (version === null) {
      if (cachedGardenIndex && !outdated) return pick(cachedGardenIndex);
      await delay(STABLE_READ_RETRY_MS);
      continue;
    }
    if (cachedGardenIndex?.version === version) {
      return pick(cachedGardenIndex);
    }
    if (cachedGardenIndex) outdated = true;

    let built: Pick<CachedGardenIndexes, 'index' | 'ownerIndex'>;
    try {
      built = buildAudienceIndexes(await loadNoteSources());
    } catch (error) {
      return fallback(error);
    }
    let confirmedVersion: string | null;
    try {
      confirmedVersion = await readStableContentVersion();
    } catch (error) {
      return fallback(error);
    }
    if (confirmedVersion === version) {
      const cached = { version, ...built };
      cachedGardenIndexes.set(base, cached);
      return pick(cached);
    }
    await delay(STABLE_READ_RETRY_MS);
  }

  if (outdated) throw new GardenOutdatedError();
  if (cachedGardenIndex) return pick(cachedGardenIndex);
  throw new GardenBusyError();
}

export type GardenIndexResult =
  { ok: true; index: GardenIndex } | { ok: false; response: Response };

// A garden with no root index document, a mid-mutation store, or a store the
// runtime cannot reach is a content-store state, not a crash. Every route that
// reaches the index loads it through this guard so those states read as 503
// "not ready" instead of a 500. Any other failure is a real bug and still throws.
export async function getGardenIndexOrUnavailable(
  options?: GardenIndexOptions,
): Promise<GardenIndexResult> {
  try {
    return { ok: true, index: await getGardenIndex(options) };
  } catch (error) {
    if (
      error instanceof GardenUnavailableError ||
      isStorageUnavailableError(error)
    ) {
      const retryAfterSeconds =
        error instanceof GardenUnavailableError ? error.retryAfterSeconds : 5;
      return {
        ok: false,
        response: new Response('Notes are not available yet.', {
          status: 503,
          headers: retryAfterSeconds
            ? { 'Retry-After': String(retryAfterSeconds) }
            : undefined,
        }),
      };
    }
    throw error;
  }
}
