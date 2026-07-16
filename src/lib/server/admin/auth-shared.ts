import {
  decodeBase64UrlToText,
  encodeTextToBase64Url,
  signHmac,
  verifyHmac,
} from '../crypto';

export { constantTimeCompare, sha256Hex as computeTokenHash } from '../crypto';

export const ADMIN_COOKIE = 'oddava-admin-session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_SECONDS * 1000;

export interface AdminSession {
  role: 'admin';
  // A keyed binding to the configured admin token — an HMAC under the signing
  // secret, not a bare digest. It rotates with the token, which is what lets
  // `isAdminRequest` reject sessions minted against a retired token, and it is
  // not an offline-guessable preimage of the token itself.
  tokenBinding: string;
  issuedAt: number;
}

export function signSessionValue(
  value: string,
  secret: string,
): Promise<string> {
  return signHmac(value, secret);
}

function verifySessionSignature(
  value: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  return verifyHmac(value, signature, secret);
}

export async function parseSessionValue(
  value: string | undefined,
  secret: string,
): Promise<AdminSession | null> {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1 || separator === value.length - 1) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!(await verifySessionSignature(body, signature, secret))) return null;

  try {
    const parsed = JSON.parse(
      decodeBase64UrlToText(body),
    ) as Partial<AdminSession>;
    if (
      parsed.role !== 'admin' ||
      typeof parsed.tokenBinding !== 'string' ||
      !parsed.tokenBinding ||
      typeof parsed.issuedAt !== 'number' ||
      !Number.isFinite(parsed.issuedAt)
    ) {
      return null;
    }
    return {
      role: 'admin',
      tokenBinding: parsed.tokenBinding,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

export async function createSignedSessionValue(
  session: AdminSession,
  secret: string,
): Promise<string> {
  const body = encodeTextToBase64Url(JSON.stringify(session));
  return `${body}.${await signSessionValue(body, secret)}`;
}

export async function verifySession(
  value: string | undefined,
  secret: string,
): Promise<AdminSession | null> {
  const session = await parseSessionValue(value, secret);
  if (!session) return null;

  const age = Date.now() - session.issuedAt;
  return Number.isFinite(age) && age >= 0 && age <= ADMIN_SESSION_TTL_MS
    ? session
    : null;
}
