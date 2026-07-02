import { useState } from 'react';
import type { IntegrationStatus } from './types';
import { SpotifyCredentialsForm } from './SpotifyCredentialsForm';

interface IntegrationStatusListProps {
  statuses: IntegrationStatus[];
  onToggle?: (key: string, name: string, enabled: boolean) => void;
  onCredentialsSaved?: () => Promise<void>;
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
  onToggle,
  onCredentialsSaved,
  busyKey,
}: IntegrationStatusListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const hasSpotify = statuses.some((status) => status.key === 'spotify');

  return (
    <article id="integrations" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">manageable</p>
          <h2>Integrations</h2>
        </div>
      </div>
      <div className="admin-integration-list">
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
                      title={
                        isEnabled
                          ? 'Enabled — click to disable'
                          : 'Disabled — click to enable'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        disabled={isBusy}
                        onChange={() => {
                          const next = !isEnabled;
                          const action = next ? 'enable' : 'disable';
                          if (
                            window.confirm(
                              `${
                                action.charAt(0).toUpperCase() + action.slice(1)
                              } ${status.name} integration?`,
                            )
                          ) {
                            onToggle?.(
                              status.key ?? status.name,
                              status.name,
                              next,
                            );
                          }
                        }}
                      />
                      <span className="admin-toggle__track">
                        <span className="admin-toggle__thumb" />
                      </span>
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
    </article>
  );
}
