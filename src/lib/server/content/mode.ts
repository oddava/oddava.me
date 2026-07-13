import { getServerEnv } from '../env';

/**
 * Local mode is an explicit development-only authoring option. Every other
 * environment uses the Redis content store, including production even if an
 * obsolete CONTENT_WRITE_MODE value is still present in its deployment vars.
 */
export function usesLocalContentFiles(): boolean {
  return import.meta.env.DEV && getServerEnv('CONTENT_WRITE_MODE') === 'local';
}
