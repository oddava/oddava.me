import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationError } from '../src/lib/server/integrations/errors';
import { fetchLanyardNowPlaying } from '../src/lib/server/integrations/providers/lanyard';

const CREDENTIALS = { discordUserId: '123456789012345678' };

describe('lanyard provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a validated Spotify presence', async () => {
    const now = 1_800_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: true,
        data: {
          spotify: {
            song: 'Track',
            artist: 'Artist',
            album_art_url: 'https://image.example/cover.jpg',
            track_id: 'track/id',
            timestamps: { start: now - 5_000, end: now + 195_000 },
          },
        },
      }),
    );

    await expect(fetchLanyardNowPlaying(CREDENTIALS)).resolves.toEqual({
      albumImageUrl: 'https://image.example/cover.jpg',
      artist: 'Artist',
      durationMs: 200_000,
      fromFallback: true,
      isPlaying: true,
      progressMs: 5_000,
      songUrl: 'https://open.spotify.com/track/track%2Fid',
      title: 'Track',
    });
  });

  it('treats an empty presence as a healthy idle result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ success: true, data: { spotify: null } }),
    );

    await expect(fetchLanyardNowPlaying(CREDENTIALS)).resolves.toEqual({
      fromFallback: true,
      isPlaying: false,
    });
  });

  it('classifies an untracked user as an operator-action error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: false,
        error: { message: 'User is not monitored.' },
      }),
    );

    const error = (await fetchLanyardNowPlaying(CREDENTIALS).catch(
      (caught: unknown) => caught,
    )) as IntegrationError;

    expect(error.code).toBe('not_configured');
    expect(error.message).toBe('User is not monitored.');
  });

  it('rejects malformed successful payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: true,
        data: { spotify: { song: 'Track', timestamps: { start: 'never' } } },
      }),
    );

    const error = (await fetchLanyardNowPlaying(CREDENTIALS).catch(
      (caught: unknown) => caught,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('timestamps.start');
  });

  it('does not call Lanyard without a Discord user ID', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const error = (await fetchLanyardNowPlaying({}).catch(
      (caught: unknown) => caught,
    )) as IntegrationError;

    expect(error.code).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
