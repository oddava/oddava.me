import { noteDataSchema } from '../content/schemas';
import {
  parseContentDocument,
  readRedisNoteFiles,
  readStableContentVersion,
} from '../server/content';
import { isStorageUnavailableError } from '../server/core';
import { buildGardenIndex } from './build';
import { GardenBusyError, GardenUnavailableError } from './errors';
import type { GardenIndex, NoteSource } from './types';

async function loadNoteSources(): Promise<NoteSource[]> {
  return (await readRedisNoteFiles()).map((file) => {
    const document = parseContentDocument(file.content);
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
      data: parsed.success ? parsed.data : {},
      body: document.body,
      updatedAt: file.updatedAt,
    };
  });
}

let cachedGardenIndex: { version: string; index: GardenIndex } | null = null;

function waitForStableContent(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

export async function getGardenIndex(): Promise<GardenIndex> {
  // The index must be built from one stable snapshot. The mutation
  // lock covers compound Studio operations; checking the version again after
  // the build also catches a write that began between the first check and the
  // file reads. Only plain data is cached globally—never request-bound I/O.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let version: string | null;
    try {
      version = await readStableContentVersion();
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    if (version === null) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      await waitForStableContent();
      continue;
    }
    if (cachedGardenIndex?.version === version) {
      return cachedGardenIndex.index;
    }

    let index: GardenIndex;
    try {
      index = buildGardenIndex(await loadNoteSources());
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    let confirmedVersion: string | null;
    try {
      confirmedVersion = await readStableContentVersion();
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    if (confirmedVersion === version) {
      cachedGardenIndex = { version, index };
      return index;
    }
    await waitForStableContent();
  }

  if (cachedGardenIndex) return cachedGardenIndex.index;
  throw new GardenBusyError();
}

export type GardenIndexResult =
  { ok: true; index: GardenIndex } | { ok: false; response: Response };

// A garden with no root index document, a mid-mutation store, or a store the
// runtime cannot reach is a content-store state, not a crash. Every route that
// reaches the index loads it through this guard so those states read as 503
// "not ready" instead of a 500. Any other failure is a real bug and still throws.
export async function getGardenIndexOrUnavailable(): Promise<GardenIndexResult> {
  try {
    return { ok: true, index: await getGardenIndex() };
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
