import { getSigningSecret, hasCommunitySigningSecret } from './config';
import { json } from './http';
import { getClientIp } from './request';

export { hasCommunitySigningSecret };

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    '',
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeTextToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function decodeBase64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSigningSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signString(value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await getHmacKey(),
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyStringSignature(
  value: string,
  expected: string,
): Promise<boolean> {
  try {
    // `crypto.subtle.verify` rejects asynchronously when the key/inputs are
    // malformed; convert those rejections to `false` instead of letting them
    // escape. The synchronous try/catch still guards importKey/coercion.
    return await crypto.subtle
      .verify(
        'HMAC',
        await getHmacKey(),
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

export function rejectIfSigningUnavailable(): Response | null {
  if (hasCommunitySigningSecret()) return null;
  return json(
    {
      error:
        'This feature is unavailable because COMMUNITY_SIGNING_SECRET is not configured.',
      code: 'signing_unavailable',
    },
    { status: 503 },
  );
}

export async function getClientFingerprint(request: Request): Promise<string> {
  return signString(`client-ip:${getClientIp(request)}`);
}

export async function createSignedValue(
  payload: Record<string, unknown>,
): Promise<string> {
  const body = encodeTextToBase64Url(JSON.stringify(payload));
  const signature = await signString(body);
  return `${body}.${signature}`;
}

export async function readSignedValue<T>(
  value: string | undefined,
): Promise<T | null> {
  if (!value) return null;

  const separatorIndex = value.lastIndexOf('.');
  if (separatorIndex === -1) return null;

  const body = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (!(await verifyStringSignature(body, signature))) return null;

  try {
    return JSON.parse(decodeBase64UrlToText(body)) as T;
  } catch {
    return null;
  }
}
