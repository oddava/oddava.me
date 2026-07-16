import {
  getTurnstileSecretKey,
  getTurnstileSiteKey,
  isTurnstileBypassEnabled,
  TURNSTILE_VERIFY_ENDPOINT,
} from '../../core/config';
import { IntegrationError } from '../errors';
import { integrationFetchJson } from '../http';
import { isConfiguredSecret } from '../../secrets';
import type { IntegrationCheckResult, IntegrationDefinition } from '../types';

const LABEL = 'Turnstile';

/**
 * Cloudflare publishes a secret key that is documented to always fail
 * verification. Posting a dummy token against it is the only way to prove the
 * *endpoint* is reachable without holding a real, single-use widget token —
 * so we send our real secret and read the specific error code Cloudflare
 * returns. `invalid-input-response` means "your secret was accepted, the token
 * was not", which is exactly the healthy answer for a synthetic probe.
 */
const PROBE_TOKEN = 'connection-test';
const SECRET_REJECTED_CODES = new Set([
  'invalid-input-secret',
  'missing-input-secret',
]);
const TOKEN_REJECTED_CODES = new Set([
  'invalid-input-response',
  'missing-input-response',
  'timeout-or-duplicate',
]);

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

function parseSiteverifyResponse(value: unknown): SiteverifyResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IntegrationError({
      code: 'invalid_response',
      message: 'Cloudflare returned a non-object siteverify response.',
    });
  }

  const payload = value as Record<string, unknown>;
  if (payload.success !== undefined && typeof payload.success !== 'boolean') {
    throw new IntegrationError({
      code: 'invalid_response',
      message: 'Cloudflare returned an invalid siteverify success field.',
    });
  }
  if (
    payload['error-codes'] !== undefined &&
    (!Array.isArray(payload['error-codes']) ||
      !payload['error-codes'].every((code) => typeof code === 'string'))
  ) {
    throw new IntegrationError({
      code: 'invalid_response',
      message: 'Cloudflare returned invalid siteverify error codes.',
    });
  }

  return payload as SiteverifyResponse;
}

export const turnstileIntegration: IntegrationDefinition = {
  id: 'turnstile',
  name: 'Turnstile',
  description:
    'Cloudflare bot protection for guestbook submissions. Configured through deployment secrets.',
  docsUrl: 'https://developers.cloudflare.com/turnstile/',
  // Bot protection is a security control, not a convenience feature. Exposing a
  // switch that disables it from a web UI would turn a single compromised admin
  // session into an open spam relay, so it is reported but never toggled here.
  manageable: false,
  enabledByDefault: true,
  // Keys are deployment secrets, not operator-editable values: rotating them
  // requires a redeploy anyway, and the site key must be baked into the client.
  credentials: [],

  async check(_credentials, signal): Promise<IntegrationCheckResult> {
    if (isTurnstileBypassEnabled()) {
      return {
        state: 'degraded',
        detail:
          'Bypassed in development (TURNSTILE_BYPASS_IN_DEV). Guestbook submissions are not challenged.',
      };
    }

    const siteKey = getTurnstileSiteKey();
    const secretKey = getTurnstileSecretKey();

    if (!isConfiguredSecret(siteKey) || !isConfiguredSecret(secretKey)) {
      throw new IntegrationError({
        code: 'not_configured',
        message:
          'PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be set. Guestbook posting is refused until they are.',
      });
    }

    const response = await integrationFetchJson<SiteverifyResponse>(
      TURNSTILE_VERIFY_ENDPOINT,
      {
        label: LABEL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: secretKey!,
          response: PROBE_TOKEN,
        }),
        signal,
      },
    );

    const payload = parseSiteverifyResponse(response);
    const errorCodes = payload['error-codes'] ?? [];

    if (errorCodes.some((code) => SECRET_REJECTED_CODES.has(code))) {
      throw new IntegrationError({
        code: 'invalid_credentials',
        message:
          'Cloudflare rejected TURNSTILE_SECRET_KEY. Guestbook submissions will fail verification.',
      });
    }

    if (errorCodes.some((code) => TOKEN_REJECTED_CODES.has(code))) {
      return {
        state: 'ok',
        detail:
          'Connected. Cloudflare accepted the secret key and the siteverify endpoint is reachable.',
      };
    }

    // Neither the expected rejection nor a recognized failure. Report it rather
    // than guessing, so an API change surfaces instead of silently reading OK.
    throw new IntegrationError({
      code: 'invalid_response',
      message: `Cloudflare returned an unexpected siteverify result${
        errorCodes.length ? `: ${errorCodes.join(', ')}` : '.'
      }`,
    });
  },
};
