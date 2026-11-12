import type { PublicStar, SkyApiResponse } from '../../lib/contracts';
import { isRecord } from '../../lib/records';

export interface SkyState {
  stars: PublicStar[];
  writable: boolean;
}

function isPublicStar(value: unknown): value is PublicStar {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.createdAt === 'string' &&
    (value.word === undefined || typeof value.word === 'string')
  );
}

async function readPayload(response: Response): Promise<SkyApiResponse> {
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload)) throw new Error('the sky answered with nonsense.');
  return payload as SkyApiResponse;
}

export async function fetchSky(): Promise<SkyState> {
  const response = await fetch('/api/sky', { cache: 'no-store' });
  const data = await readPayload(response);
  if (!response.ok || !Array.isArray(data.stars)) {
    throw new Error(data.error ?? 'could not load the sky.');
  }
  return {
    stars: data.stars.filter(isPublicStar),
    writable: data.writable !== false,
  };
}

export class StarError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** "in 3 hours", "in 12 minutes": how long until the limit resets. */
function waitFor(seconds: number): string {
  if (seconds >= 5400) return `in ${Math.round(seconds / 3600)} hours`;
  if (seconds >= 90) return `in ${Math.round(seconds / 60)} minutes`;
  return 'in a minute';
}

export async function placeStar(input: {
  x: number;
  y: number;
  word: string;
}): Promise<{ star: PublicStar; wordPending: boolean }> {
  const response = await fetch('/api/sky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await readPayload(response);
  if (!response.ok || !isPublicStar(data.star)) {
    if (data.code === 'rate_limited') {
      throw new StarError(
        `that's three stars today. the sky saves you a spot ${waitFor(
          data.retryAfterSeconds ?? 3600,
        )}.`,
        data.code,
      );
    }
    if (data.code === 'sky_busy') {
      throw new StarError(
        `lots of stars tonight. try again ${waitFor(data.retryAfterSeconds ?? 600)}.`,
        data.code,
      );
    }
    if (data.code === 'sky_full') {
      throw new StarError('the sky is full tonight.', data.code);
    }
    throw new StarError(
      (data.error ?? 'could not place your star.').toLowerCase(),
      data.code,
    );
  }
  return { star: data.star, wordPending: data.wordPending === true };
}
