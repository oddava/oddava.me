/**
 * The garden cannot be served right now, and that is a content-store state
 * rather than a bug. Every subclass reads as 503 through
 * `getGardenIndexOrUnavailable`; anything else still throws.
 */
export abstract class GardenUnavailableError extends Error {
  abstract readonly code: string;

  /** Seconds to advertise in `Retry-After`, when the wait is knowable. */
  readonly retryAfterSeconds?: number;
}

export class GardenEmptyError extends GardenUnavailableError {
  readonly code = 'garden_empty';

  constructor() {
    super('The notes garden needs an index document as its root.');
    this.name = 'GardenEmptyError';
  }
}

/**
 * A compound mutation holds the content lock, so no stable snapshot exists to
 * build from, and this isolate has no cached index to fall back on. A warm
 * isolate never gets here — it serves its cache. `notes:migrate` holds the lock
 * for its whole run, so this is the state a cold request meets during a
 * migration, and it must read as "not ready", not as a crash.
 */
export class GardenBusyError extends GardenUnavailableError {
  readonly code = 'garden_busy';
  override readonly retryAfterSeconds = 5;

  constructor() {
    super('The notes garden is being updated. Try again shortly.');
    this.name = 'GardenBusyError';
  }
}
