import { signHmac } from './crypto';
import { getSigningSecret, hasSigningSecret } from './config';
import { json } from './http';
import { getClientIp } from './request';

export { getSigningSecret, hasSigningSecret };

function signString(value: string): Promise<string> {
  return signHmac(value, getSigningSecret());
}

export function rejectIfSigningUnavailable(): Response | null {
  if (hasSigningSecret()) return null;
  return json(
    {
      error:
        'This feature is unavailable because COMMUNITY_SIGNING_SECRET is not configured.',
      code: 'signing_unavailable',
    },
    { status: 503 },
  );
}

/**
 * The part of an address that names a visitor rather than a device: an IPv4
 * address whole, an IPv6 address by its /64. One IPv6 subscriber holds a
 * whole /64 and their devices rotate through it daily, so the full address
 * would count one person as many, and hand anyone a fresh rate limit for
 * the price of a new address.
 */
export function clientNetwork(ip: string): string {
  const address = ip.trim().toLowerCase().split('%')[0]!;
  if (!address.includes(':')) return address;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is the IPv4 address.
  const mapped = /^(?:0{0,4}:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return mapped[1]!;
  const compressed = address.includes('::');
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = compressed && tail ? tail.split(':') : [];
  const groups = compressed
    ? [
        ...left,
        ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'),
        ...right,
      ]
    : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return address;
  }
  const prefix = groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
  return `${prefix}::/64`;
}

export async function getClientFingerprint(request: Request): Promise<string> {
  return signString(`client-ip:${clientNetwork(getClientIp(request))}`);
}

/**
 * A browser's key for the visitor counts: an HMAC of the random id the page
 * keeps, and nothing else, so a phone moving from wifi to mobile data stays
 * one visitor, and the stored key reads back as nothing at all.
 */
export function getVisitorKey(id: string): Promise<string> {
  return signString(`visitor:${id}`);
}
