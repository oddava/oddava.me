import { signHmac } from '../crypto';
import { getSigningSecret, hasCommunitySigningSecret } from './config';
import { json } from './http';
import { getClientIp } from './request';

export { hasCommunitySigningSecret };

function signString(value: string): Promise<string> {
  return signHmac(value, getSigningSecret());
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
