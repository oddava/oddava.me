export interface SpotifyTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface SpotifyApiPayload {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: {
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: { images?: Array<{ url?: string }> };
    external_urls?: { spotify?: string };
  } | null;
}

export interface LanyardPayload {
  success?: boolean;
  data?: {
    spotify?: {
      song?: string;
      artist?: string;
      album_art_url?: string;
      track_id?: string;
      timestamps?: {
        start?: number;
        end?: number;
      };
    };
  };
}
