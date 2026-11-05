import { AsyncLocalStorage } from 'node:async_hooks';
import { isNotesHost } from '../../notes-host';
import { setNotesBaseOverride } from '../../notes-url';
import { getServerEnv } from './env';

/**
 * Whether a request arrived on the notes hostname. `NOTES_HOST` names it;
 * unset, only dev has one (notes.localhost), so production is unaffected until
 * the variable is set.
 */
export function isNotesHostRequest(url: URL): boolean {
  return isNotesHost(
    url.hostname,
    getServerEnv('NOTES_HOST'),
    import.meta.env.DEV,
  );
}

// Set for the whole of a notes-host request, across every await, so links
// built anywhere while it renders (including the cached garden index, keyed
// by base) come out root-relative. A module global would leak between
// concurrent requests in one isolate.
const notesHostRequest = new AsyncLocalStorage<true>();

setNotesBaseOverride(() => (notesHostRequest.getStore() ? '' : undefined));

/** Runs `fn` as a notes-host request: notes links are root-relative in it. */
export function runAsNotesHostRequest<T>(fn: () => T): T {
  return notesHostRequest.run(true, fn);
}

/**
 * The origin absolute URLs on this response should use: the notes host's own
 * origin for a notes-host request, else the personal site's canonical origin
 * (`fallback`, normally SITE_URL — never the dev or preview host).
 */
export function publicOriginFor(url: URL, fallback: string): string {
  return isNotesHostRequest(url) ? url.origin : fallback;
}
