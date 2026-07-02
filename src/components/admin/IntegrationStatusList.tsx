import type { IntegrationStatus } from './types';

interface IntegrationStatusListProps {
  statuses: IntegrationStatus[];
  onToggle?: (key: string, name: string, enabled: boolean) => void;
  busyKey?: string | null;
}

export function IntegrationStatusList({
  statuses,
  onToggle,
  busyKey,
}: IntegrationStatusListProps) {
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
              {manageable && (
                <div className="admin-integration-row__toggle">
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
