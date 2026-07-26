import { createRedisContentProvider, readRedisBinaryFile } from './redis-store';
import type { ContentProvider } from './types';

/**
 * Derived data, deliberately outside `public/images/notes`. That tree is the
 * one `notes:export` mirrors into git and `notes:migrate -- --prune` garbage
 * collects against the committed tree; a card is re-drawable from the note it
 * describes, so backing it up would only add binary churn to every export, and
 * a prune run would delete every card as an unknown key.
 */
export const SOCIAL_CARD_DIR = 'public/images/og/notes';
const SOCIAL_CARD_EXTENSION = 'png';

/**
 * The fingerprint is part of the key, not a field beside it, so a stale card is
 * never *served*: the route derives the current fingerprint from the live index
 * and simply misses. Superseded keys are dropped by the next write rather than
 * left to accumulate — nothing else collects this tree.
 */
export function socialCardStoragePath(
  path: string,
  fingerprint: string,
): string {
  return `${SOCIAL_CARD_DIR}/${path}.${fingerprint}.${SOCIAL_CARD_EXTENSION}`;
}

export function readSocialCard(
  path: string,
  fingerprint: string,
): Promise<Uint8Array | null> {
  return readRedisBinaryFile(socialCardStoragePath(path, fingerprint));
}

async function storedCards(
  provider: ContentProvider,
  path?: string,
): Promise<string[]> {
  const paths = await provider.listFilePaths(
    SOCIAL_CARD_DIR,
    SOCIAL_CARD_EXTENSION,
  );
  if (path === undefined) return paths;
  // `${path}.` and not `${path}` — otherwise the card for `reading` would also
  // claim `reading/books`'s key as its own to prune.
  return paths.filter((candidate) =>
    candidate.startsWith(`${SOCIAL_CARD_DIR}/${path}.`),
  );
}

/** `${path}.${fingerprint}` for every card the store already holds. */
export async function listSocialCardKeys(): Promise<Set<string>> {
  const prefix = `${SOCIAL_CARD_DIR}/`;
  const suffix = `.${SOCIAL_CARD_EXTENSION}`;
  const paths = await storedCards(createRedisContentProvider());
  return new Set(
    paths.map((path) => path.slice(prefix.length, -suffix.length)),
  );
}

/**
 * Writes one card and drops the note's superseded ones. Callers hold the
 * content mutation lock, so the read-then-delete of the stale keys cannot race
 * another writer's create.
 */
export async function writeSocialCard(
  path: string,
  fingerprint: string,
  bytes: Uint8Array,
): Promise<void> {
  const provider = createRedisContentProvider();
  const target = socialCardStoragePath(path, fingerprint);
  const existing = await storedCards(provider, path);

  // Binary writes are creates, never compare-and-set: re-rendering identical
  // text is a no-op rather than a conflict.
  if (!existing.includes(target)) {
    await provider.writeBinaryFile(
      target,
      bytes,
      `content: render social card ${path}`,
    );
  }

  for (const stale of existing) {
    if (stale === target) continue;
    const file = await provider.readFile(stale);
    if (!file) continue;
    await provider.deleteFile(
      stale,
      `content: drop superseded social card ${path}`,
      file.revision,
    );
  }
}
