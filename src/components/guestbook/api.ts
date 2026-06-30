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

function guestbookErrorMessage(data: GuestbookApiResponse): string {
  if (data.retryAfterSeconds) {
    return `${data.error ?? 'Could not post your message.'} Try again in ${data.retryAfterSeconds}s.`;
  }

  return data.error ?? 'Could not post your message.';
}

export async function fetchGuestbookState(): Promise<GuestbookState> {
  const response = await fetch('/api/guestbook', { cache: 'no-store' });
  const data = (await response.json()) as GuestbookApiResponse;

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load guestbook.');
  }

  return {
    captchaRequired: Boolean(data.captchaRequired && data.turnstileSiteKey),
    entries: data.entries ?? [],
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
  const data = (await response.json()) as GuestbookApiResponse;

  if (!response.ok) {
    throw new Error(guestbookErrorMessage(data));
  }

  return data.message ?? 'Thanks. Your note will appear soon.';
}
