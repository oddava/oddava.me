import { useState } from 'react';
import type { IntegrationStatus } from './types';
import { SkeletonRow } from './Skeleton';
import { SpotifyCredentialsForm } from './SpotifyCredentialsForm';
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
      }}
    >
      <path d="M2 4.5L6 8.5L10 4.5" />
    </svg>
  );
}

export function IntegrationStatusList({
  statuses,
  loading = false,
  onToggle,
  onCredentialsSaved,
  onRetry,
  busyKey,
}: IntegrationStatusListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { confirm, dialog } = useDialogConfirm();
  const hasSpotify = statuses.some((status) => status.key === 'spotify');

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
          const isExpanded = expandedKey === status.key;
          const showCredentials =
            status.key === 'spotify' && hasSpotify && onCredentialsSaved;
          const toggleId = `integration-toggle-${
            status.key ?? status.name
          }`;

          return (
            <div
              className={`admin-integration-row ${
                isExpanded ? 'is-expanded' : ''
              }`}
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
                    className="admin-integration-row__expand"
                    onClick={() =>
                      setExpandedKey(isExpanded ? null : (status.key ?? null))
                    }
                    aria-expanded={isExpanded}
                    aria-controls={`${status.key}-credentials`}
                  >
                    <span>Credentials</span>
                    <ChevronIcon expanded={isExpanded} />
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
                        onChange={() => void handleToggleChange(status, !isEnabled)}
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
              {showCredentials && isExpanded && (
                <div
                  id={`${status.key}-credentials`}
                  className="admin-integration-row__credentials"
                >
                  <SpotifyCredentialsForm
                    onSaved={onCredentialsSaved}
                    busyKey={busyKey}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dialog}
    </article>
  );
}