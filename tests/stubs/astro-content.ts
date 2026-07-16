// A tripwire, not a fake. Notes are read from Redis, never from the Astro
// collection — so reaching this is the bug, and it should fail loudly rather
// than answer. If a test needs notes, mock the Redis store instead.
export async function getCollection(): Promise<never> {
  throw new Error(
    'The Astro notes collection is not a content source. Notes are read from Redis; mock the Redis store instead.',
  );
}
