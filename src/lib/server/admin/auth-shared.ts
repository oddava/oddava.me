/**
 * Node/Worker-agnostic admin session primitives.
 *
 * This module contains ONLY pure logic that runs in both the Cloudflare
 * Worker runtime (WebCrypto, TextEncoder) and a plain Node.js context
 * (used by `vite/local-content-admin-dev-proxy.mjs`). It deliberately has
 * NO imports from `cloudflare:workers`, `astro`, or anything that touches
 * `Request`/`Response`/env bindings — those live in `auth.ts`.
 *
 * The local content dev proxy imports this module directly via Vite's
 * `runnerImport` (TS is transpiled on the fly), so the Worker path
 * (`auth.ts`) and the Node proxy path stay byte-for-byte compatible for
 * HMAC + SHA-256 + session parsing, eliminating the previous duplicated
 * `node:crypto` implementation. Drift is additionally guarded by
 * `tests/admin-auth-shared.test.ts`.
 */

export const ADMIN_COOKIE = 'oddava-admin-session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
export const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_SECONDS * 1000;

export interface AdminSession {
  role: 'admin';
  tokenHash: string;
  issuedAt: number;
}

/** Base64url encode a byte buffer using only Web-platform primitives. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    '',
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** Base64url decode to a byte array using only Web-platform primitives. */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeTextToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

export function decodeBase64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/** SHA-256 hex digest via WebCrypto. */
export async function computeTokenHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison. Returns false for differing lengths, then
 * XOR-accumulates so timing does not leak the position of the first diff.
 */
export function constantTimeCompare(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** HMAC-SHA256(base64url-signature) of `value` using `secret`. */
export async function signSessionValue(
  value: string,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await getHmacKey(secret),
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * Verify a base64url HMAC signature for `value` against `secret`. Rejections
 * from `crypto.subtle.verify` (malformed input) are converted to `false`
 * rather than allowed to escape.
 */
export async function verifySessionSignature(
  value: string,
  expected: string,
  secret: string,
): Promise<boolean> {
  try {
    return await crypto.subtle
      .verify(
        'HMAC',
        await getHmacKey(secret),
        base64UrlToBytes(expected).buffer as ArrayBuffer,
        new TextEncoder().encode(value),
      )
      .then(
        (ok) => ok,
        () => false,
      );
  } catch {
    return false;
  }
}

/**
 * Parse and verify a `body.signature` session string. Returns the decoded
 * `AdminSession` payload (with `issuedAt` as a number) when the signature is
 * valid and all required fields are present, otherwise `null`.
 *
 * Expiry (issuedAt older than TTL) is NOT checked here — callers decide
 * whether to enforce TTL so this stays a pure parse/verify helper.
 */
export async function parseSessionValue(
  value: string | undefined,
  secret: string,
): Promise<AdminSession | null> {
  if (!value) return null;

  const separatorIndex = value.lastIndexOf('.');
  if (separatorIndex === -1) return null;

  const body = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (!(await verifySessionSignature(body, signature, secret))) return null;

  try {
    const parsed = JSON.parse(
      decodeBase64UrlToText(body),
    ) as Partial<AdminSession>;
    if (
      parsed.role !== 'admin' ||
      typeof parsed.tokenHash !== 'string' ||
      !parsed.tokenHash ||
      typeof parsed.issuedAt !== 'number' ||
      !Number.isFinite(parsed.issuedAt)
    ) {
      return null;
    }
    return {
      role: 'admin',
      tokenHash: parsed.tokenHash,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Build a signed session string (`base64url(body).base64url(signature)`) for
 * the given admin session payload.
 */
export async function createSignedSessionValue(
  session: AdminSession,
  secret: string,
): Promise<string> {
  const body = encodeTextToBase64Url(JSON.stringify(session));
  const signature = await signSessionValue(body, secret);
  return `${body}.${signature}`;
}

/**
 * Parse, signature-verify, AND expiry-check a session string. Returns the
 * `AdminSession` when the signature is valid and `issuedAt` is within the
 * TTL window (and not in the future), otherwise `null`. This is the helper
 * used by both the Worker (`auth.ts`) and the local dev proxy so the TTL
 * rule cannot drift between them.
 */
export async function verifySession(
  value: string | undefined,
  secret: string,
): Promise<AdminSession | null> {
  const session = await parseSessionValue(value, secret);
  if (!session) return null;

  const ageMs = Date.now() - session.issuedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ADMIN_SESSION_TTL_MS) {
    return null;
  }
  return session;
}
