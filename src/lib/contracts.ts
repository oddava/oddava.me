export interface PublicGuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
}

export interface GuestbookApiResponse {
  entries?: PublicGuestbookEntry[];
  writable?: boolean;
  reviewRequired?: boolean;
  captchaRequired?: boolean;
  turnstileSiteKey?: string;
  submitted?: boolean;
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
}

export interface SpotifyIntegrations {
  spotify: boolean;
  lanyard: boolean;
}

export interface SpotifyNowPlaying {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  albumImageUrl?: string;
  songUrl?: string;
  durationMs?: number;
  progressMs?: number;
  fromFallback?: boolean;
  error?: string;
  source?: 'spotify' | 'lanyard';
  integrations?: SpotifyIntegrations;
}
