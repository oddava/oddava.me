import type {
  GuestbookApiResponse,
  PublicGuestbookEntry,
} from '../../lib/contracts';

interface GuestbookState {
  captchaRequired: boolean;
  entries: PublicGuestbookEntry[];
  turnstileSiteKey: string;
  writable: boolean;
}

interface SubmitGuestbookEntryInput {
  captchaToken: string;
  message: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicGuestbookEntry(value: unknown): value is PublicGuestbookEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    typeof value.createdAt === 'string'
  );
}

async function readGuestbookPayload(
  response: Response,
): Promise<GuestbookApiResponse> {
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error('Guestbook API returned an invalid payload.');
  }
  return payload as GuestbookApiResponse;
}

function guestbookErrorMessage(data: GuestbookApiResponse): string {
  if (data.retryAfterSeconds) {
    return `${data.error ?? 'Could not post your message.'} Try again in ${data.retryAfterSeconds}s.`;
  }

  return data.error ?? 'Could not post your message.';
}

export async function fetchGuestbookState(): Promise<GuestbookState> {
  const response = await fetch('/api/guestbook', { cache: 'no-store' });
  const data = await readGuestbookPayload(response);

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load guestbook.');
  }

  if (
    !Array.isArray(data.entries) ||
    !data.entries.every(isPublicGuestbookEntry)
  ) {
    throw new Error('Guestbook API returned invalid entries.');
  }

  return {
    captchaRequired: Boolean(data.captchaRequired && data.turnstileSiteKey),
    entries: data.entries,
    turnstileSiteKey: data.turnstileSiteKey ?? '',
    writable: data.writable !== false,
  };
}

export async function submitGuestbookEntry({
  captchaToken,
  message,
  name,
}: SubmitGuestbookEntryInput): Promise<string> {
  const response = await fetch('/api/guestbook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      captchaToken,
      message,
      name,
    }),
  });
  const data = await readGuestbookPayload(response);

  if (!response.ok) {
    throw new Error(guestbookErrorMessage(data));
  }

  return data.message ?? 'Thanks. Your note will appear soon.';
}
