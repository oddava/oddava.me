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

export interface ClickerApiResponse {
  count: number;
  writable?: boolean;
  error?: string;
  retryAfterSeconds?: number;
}

export type MinesweeperDifficulty = 'easy' | 'medium' | 'hard';

export interface LeaderboardEntry {
  time: number;
  createdAt: string;
}

export interface LeaderboardApiResponse {
  entries: LeaderboardEntry[];
  writable?: boolean;
  error?: string;
  retryAfterSeconds?: number;
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
}
