import { useState } from 'react';
import type { IntegrationStatus } from './types';
import { SkeletonRow } from './Skeleton';
import { SpotifyCredentialsForm } from './SpotifyCredentialsForm';
import { Modal } from './Modal';
import { useDialogConfirm } from './useDialogConfirm';
import { VisuallyHidden } from './VisuallyHidden';

interface IntegrationStatusListProps {
  statuses: IntegrationStatus[];
  loading?: boolean;
  onToggle?: (key: string, name: string, enabled: boolean) => void;
  onCredentialsSaved?: () => Promise<void>;
  onRetry?: () => void;
  busyKey?: string | null;
}

export function IntegrationStatusList({
  statuses,
  loading = false,
  onToggle,
  onCredentialsSaved,
  onRetry,
  busyKey,
}: IntegrationStatusListProps) {
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const { confirm, dialog } = useDialogConfirm();
  const hasSpotify = statuses.some((status) => status.key === 'spotify');

  const handleCredentialsSaved = async () => {
    await onCredentialsSaved?.();
    setCredentialsOpen(false);
  };

  const handleToggleChange = async (
    status: IntegrationStatus,
    next: boolean,
  ) => {
    const action = next ? 'enable' : 'disable';
    const ok = await confirm({
      title: 'Toggle integration',
      message: `${
        action.charAt(0).toUpperCase() + action.slice(1)
      } ${status.name} integration?`,
      confirmLabel: `Yes, ${action}`,
      danger: !next,
    });
    if (!ok) return;
    onToggle?.(status.key ?? status.name, status.name, next);
  };

  return (
    <article id="integrations" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">manageable</p>
          <h2>Integrations</h2>
        </div>
      </div>
      <div className="admin-integration-list">
        {loading && (
          <div
            className="admin-integration-list__skeletons"
            role="status"
            aria-live="polite"
          >
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}
        {!loading && statuses.length === 0 && (
          <div className="admin-empty-state" role="status">
            <p className="admin-empty">
              Integration statuses are unavailable right now.
            </p>
            {onRetry && (
              <button
                type="button"
                className="admin-button admin-button--ghost"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {statuses.map((status) => {
          const manageable = status.manageable !== false;
          const isEnabled = status.enabled ?? true;
          const isBusy = busyKey === status.key;
          const isOff = manageable && !isEnabled;
          const pillClass = isOff
            ? 'pill'
            : `pill ${status.healthy ? 'good' : 'bad'}`;
          const pillLabel = isOff ? 'off' : status.healthy ? 'ok' : 'bad';
          const showCredentials =
            status.key === 'spotify' && hasSpotify && onCredentialsSaved;
          const toggleId = `integration-toggle-${status.key ?? status.name}`;

          return (
            <div
              className="admin-integration-row"
              key={status.key ?? status.name}
            >
              <div className="admin-integration-row__info">
                <div className="admin-integration-row__heading">
                  <span className="admin-integration-row__name">
                    {status.name}
                  </span>
                  <span className={pillClass}>{pillLabel}</span>
                </div>
                <p className="admin-integration-row__detail">{status.detail}</p>
              </div>
              <div className="admin-integration-row__toggle">
                {showCredentials && (
                  <button
                    type="button"
                    className="admin-integration-row__credentials-btn"
                    onClick={() => setCredentialsOpen(true)}
                  >
                    Credentials
                  </button>
                )}
                {manageable && (
                  <>
                    <span className="admin-integration-row__state">
                      {isEnabled ? 'On' : 'Off'}
                    </span>
                    <label
                      className={`admin-toggle ${
                        isEnabled ? 'admin-toggle--on' : ''
                      }`}
                      htmlFor={toggleId}
                      title={
                        isEnabled
                          ? 'Enabled — click to disable'
                          : 'Disabled — click to enable'
                      }
                    >
                      <input
                        id={toggleId}
                        type="checkbox"
                        checked={isEnabled}
                        disabled={isBusy}
                        onChange={() =>
                          void handleToggleChange(status, !isEnabled)
                        }
                      />
                      <span className="admin-toggle__track">
                        <span className="admin-toggle__thumb" />
                      </span>
                      <VisuallyHidden>
                        {status.name} integration toggle, currently{' '}
                        {isEnabled ? 'enabled' : 'disabled'}
                      </VisuallyHidden>
                    </label>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {dialog}
      <Modal
        open={credentialsOpen}
        title="Spotify & Lanyard credentials"
        onClose={() => setCredentialsOpen(false)}
      >
        <SpotifyCredentialsForm
          onSaved={handleCredentialsSaved}
          busyKey={busyKey}
        />
      </Modal>
    </article>
  );
}
