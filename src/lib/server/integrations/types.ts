import type {
  CredentialField,
  IntegrationErrorCode,
  IntegrationStatus as IntegrationStatusContract,
} from '../../contracts';
import type { RuntimeEnvName } from '../env';

export type { CredentialFieldStatus } from '../../contracts';

export type IntegrationId = 'spotify' | 'lanyard' | 'turnstile';

export interface CredentialFieldDefinition extends Omit<
  CredentialField,
  'envVars'
> {
  /** Env vars consulted, in priority order, when no stored override exists. */
  envVars: RuntimeEnvName[];
  /** Returns an error message when the value is unusable, otherwise null. */
  validate?: (value: string) => string | null;
}

/** Resolved credential values, keyed by field. Server-side only — never serialized to a client. */
export type IntegrationCredentials = Record<string, string | undefined>;

export interface IntegrationCheckResult {
  state: 'ok' | 'degraded' | 'unconfigured' | 'error';
  detail: string;
  code?: IntegrationErrorCode;
  retryAfterSeconds?: number;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  name: string;
  description: string;
  docsUrl?: string;
  /** Whether the operator may toggle it on and off from the admin panel. */
  manageable: boolean;
  enabledByDefault: boolean;
  /** Empty for providers configured purely through deployment env vars. */
  credentials: CredentialFieldDefinition[];
  /**
   * Performs a live connection test. Only called when the integration is
   * enabled and every required credential resolves, so implementations may
   * assume their credentials are present.
   */
  check(
    credentials: IntegrationCredentials,
    signal?: AbortSignal,
  ): Promise<IntegrationCheckResult>;

  /**
   * Called after credentials are saved or revoked, so a provider can drop
   * anything it derived from the old ones (cached tokens, sessions). Providers
   * that derive nothing may omit it.
   */
  onCredentialsChanged?(): void;
}

/** The wire shape returned by the admin API and rendered by the admin UI. */
export interface IntegrationStatus extends Omit<
  IntegrationStatusContract,
  'id' | 'fields'
> {
  id: IntegrationId;
  /** Field definitions, sans validators, so the UI can render a credential form generically. */
  fields: Array<Omit<CredentialFieldDefinition, 'validate'>>;
}
