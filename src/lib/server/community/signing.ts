import {
  decodeBase64UrlToText,
  encodeTextToBase64Url,
  signHmac,
  verifyHmac,
} from '../crypto';
import { getSigningSecret, hasCommunitySigningSecret } from './config';
import { json } from './http';
import { getClientIp } from './request';

export { hasCommunitySigningSecret };

function signString(value: string): Promise<string> {
  return signHmac(value, getSigningSecret());
}

function verifyStringSignature(
  value: string,
  signature: string,
): Promise<boolean> {
  return verifyHmac(value, signature, getSigningSecret());
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
  return `${body}.${await signString(body)}`;
}

export async function readSignedValue<T>(
  value: string | undefined,
): Promise<T | null> {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1 || separator === value.length - 1) return null;

  const body = value.slice(0, separator);
  if (!(await verifyStringSignature(body, value.slice(separator + 1)))) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64UrlToText(body)) as T;
  } catch {
    return null;
  }
}
