import type { IntegrationStatus } from './types';

interface IntegrationStatusListProps {
  statuses: IntegrationStatus[];
}

export function IntegrationStatusList({
  statuses,
}: IntegrationStatusListProps) {
  return (
    <article id="integrations" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">health</p>
          <h2>Integrations</h2>
          <p>
            Quick configuration and readiness readout for the services this site
            depends on.
          </p>
        </div>
      </div>
      <div className="status-list">
        {statuses.map((status) => (
          <div key={status.name} className="status-card">
            <header>
              <strong>{status.name}</strong>
              <span className={`pill ${status.healthy ? 'good' : 'bad'}`}>
                {status.healthy ? 'healthy' : 'attention'}
              </span>
            </header>
            <p className="admin-muted">{status.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
