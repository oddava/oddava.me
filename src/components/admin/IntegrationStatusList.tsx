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
        </div>
        <span className="pill">
          {statuses.filter((s) => s.healthy).length}/{statuses.length}
        </span>
      </div>
      <table className="admin-table">
        <tbody>
          {statuses.map((status) => (
            <tr key={status.name}>
              <td className="admin-table__name">{status.name}</td>
              <td className="admin-table__detail">{status.detail}</td>
              <td className="admin-table__status">
                <span className={`pill ${status.healthy ? 'good' : 'bad'}`}>
                  {status.healthy ? 'ok' : 'bad'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
