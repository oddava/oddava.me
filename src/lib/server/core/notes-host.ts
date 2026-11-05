import { isNotesHost } from '../../notes-host';
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
