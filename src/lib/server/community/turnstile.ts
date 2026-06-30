import {
  getTurnstileSecretKey,
  getTurnstileSiteKey,
  isTurnstileBypassEnabled,
  TURNSTILE_VERIFY_ENDPOINT,
} from './config';
import { fetchWithTimeout, json } from './http';
import { getClientIp } from './request';

export { getTurnstileSiteKey };

export function hasTurnstileConfig(): boolean {
  if (isTurnstileBypassEnabled()) return true;
  return Boolean(getTurnstileSiteKey() && getTurnstileSecretKey());
}

export function isTurnstileChallengeRequired(): boolean {
  return hasTurnstileConfig() && !isTurnstileBypassEnabled();
}

export async function verifyTurnstileToken(
  request: Request,
  token: string | undefined,
): Promise<Response | null> {
  if (isTurnstileBypassEnabled()) {
    return null;
  }

  if (!hasTurnstileConfig()) {
    return json(
      {
        error:
          'Guestbook posting is unavailable because bot protection is not configured.',
        code: 'captcha_unavailable',
      },
      { status: 503 },
    );
  }

  if (!token) {
    return json(
      {
        error: 'Bot verification is required.',
        code: 'captcha_required',
      },
      { status: 400 },
    );
  }

  let verificationResponse: Response;
  try {
    verificationResponse = await fetchWithTimeout(TURNSTILE_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: getTurnstileSecretKey()!,
        response: token,
        remoteip: getClientIp(request),
      }),
    });
  } catch (error) {
    console.error('[turnstile] verification request failed', error);
    return json(
      {
        error: 'Bot verification is temporarily unavailable.',
        code: 'captcha_unavailable',
      },
      { status: 502 },
    );
  }

  if (!verificationResponse.ok) {
    return json(
      {
        error: 'Bot verification failed.',
        code: 'captcha_failed',
      },
      { status: 502 },
    );
  }

  const payload = (await verificationResponse.json()) as { success?: boolean };
  if (!payload.success) {
    return json(
      {
        error: 'Bot verification failed.',
        code: 'captcha_failed',
      },
      { status: 400 },
    );
  }

  return null;
}
