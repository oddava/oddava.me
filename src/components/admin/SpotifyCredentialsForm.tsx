import { useEffect, useState } from 'react';
import { fetchSpotifyCredentials, updateSpotifyCredentials } from './api';
import type { SpotifyCredentialsStatus } from './types';

interface SpotifyCredentialsFormProps {
  onSaved: () => Promise<void>;
  busyKey?: string | null;
}

const ERROR_REGION_ID = 'spotify-credentials-error';
const errorRegionId = (hasError: boolean) =>
  hasError ? ERROR_REGION_ID : undefined;

interface FieldState {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  discordUserId: string;
}

const EMPTY_FIELDS: FieldState = {
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  discordUserId: '',
};

function isSet(value: { set?: boolean } | undefined): boolean {
  return Boolean(value?.set);
}

export function SpotifyCredentialsForm({
  onSaved,
  busyKey,
}: SpotifyCredentialsFormProps) {
  const [status, setStatus] = useState<SpotifyCredentialsStatus | null>(null);
  const [fields, setFields] = useState<FieldState>(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isBusy = busyKey === 'spotify-credentials';

  const loadStatus = async () => {
    try {
      const data = await fetchSpotifyCredentials();
      setStatus(data.credentials);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load credentials.',
      );
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleField = (key: keyof FieldState, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: {
        spotify: Record<string, string>;
        lanyard: Record<string, string>;
      } = { spotify: {}, lanyard: {} };

      if (fields.clientId) body.spotify.clientId = fields.clientId;
      if (fields.clientSecret) body.spotify.clientSecret = fields.clientSecret;
      if (fields.refreshToken) body.spotify.refreshToken = fields.refreshToken;
      if (fields.discordUserId)
        body.lanyard.discordUserId = fields.discordUserId;

      const data = await updateSpotifyCredentials(body);
      setStatus(data.credentials);
      setFields(EMPTY_FIELDS);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save credentials.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-credentials" onSubmit={handleSave}>
      <div className="admin-credentials__header">
        <h3 className="admin-credentials__title">
          Spotify &amp; Lanyard credentials
        </h3>
        <p className="admin-credentials__hint">
          Stored securely in persistent storage. Leave a field blank to keep its
          current value.
        </p>
      </div>

      <div className="admin-credentials__grid">
        <label className="admin-credentials__field">
          <span className="admin-credentials__label">Spotify Client ID</span>
          <input
            className="admin-input"
            type="text"
            autoComplete="off"
            value={fields.clientId}
            placeholder={
              isSet(status?.spotify.clientId) ? '•••• set' : 'Not set'
            }
            disabled={saving || isBusy}
            aria-describedby={errorRegionId(Boolean(error))}
            aria-invalid={error ? true : undefined}
            onChange={(e) => handleField('clientId', e.target.value)}
          />
          <span className="admin-credentials__status">
            {isSet(status?.spotify.clientId) ? 'set' : 'not set'}
          </span>
        </label>

        <label className="admin-credentials__field">
          <span className="admin-credentials__label">
            Spotify Client Secret
          </span>
          <input
            className="admin-input"
            type="password"
            autoComplete="off"
            value={fields.clientSecret}
            placeholder={
              isSet(status?.spotify.clientSecret) ? '•••• set' : 'Not set'
            }
            disabled={saving || isBusy}
            aria-describedby={errorRegionId(Boolean(error))}
            aria-invalid={error ? true : undefined}
            onChange={(e) => handleField('clientSecret', e.target.value)}
          />
          <span className="admin-credentials__status">
            {isSet(status?.spotify.clientSecret) ? 'set' : 'not set'}
          </span>
        </label>

        <label className="admin-credentials__field">
          <span className="admin-credentials__label">
            Spotify Refresh Token
          </span>
          <input
            className="admin-input"
            type="password"
            autoComplete="off"
            value={fields.refreshToken}
            placeholder={
              isSet(status?.spotify.refreshToken) ? '•••• set' : 'Not set'
            }
            disabled={saving || isBusy}
            aria-describedby={errorRegionId(Boolean(error))}
            aria-invalid={error ? true : undefined}
            onChange={(e) => handleField('refreshToken', e.target.value)}
          />
          <span className="admin-credentials__status">
            {isSet(status?.spotify.refreshToken) ? 'set' : 'not set'}
          </span>
        </label>

        <label className="admin-credentials__field">
          <span className="admin-credentials__label">
            Discord User ID (Lanyard)
          </span>
          <input
            className="admin-input"
            type="text"
            autoComplete="off"
            value={fields.discordUserId}
            placeholder={
              isSet(status?.lanyard.discordUserId) ? '•••• set' : 'Not set'
            }
            disabled={saving || isBusy}
            aria-describedby={errorRegionId(Boolean(error))}
            aria-invalid={error ? true : undefined}
            onChange={(e) => handleField('discordUserId', e.target.value)}
          />
          <span className="admin-credentials__status">
            {isSet(status?.lanyard.discordUserId) ? 'set' : 'not set'}
          </span>
        </label>
      </div>

      {error && (
        <p
          id={ERROR_REGION_ID}
          className="admin-error admin-credentials__error"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </p>
      )}

      <div className="admin-credentials__actions">
        <button
          type="submit"
          className="admin-button"
          disabled={saving || isBusy}
        >
          {saving ? 'Saving…' : 'Save credentials'}
        </button>
      </div>
    </form>
  );
}
