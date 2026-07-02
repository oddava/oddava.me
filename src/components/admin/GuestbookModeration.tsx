import { formatDate } from './format';
import type { GuestbookEntry, GuestbookStatus } from './types';

interface GuestbookModerationProps {
  busyKey: string | null;
  entries: GuestbookEntry[];
  status: GuestbookStatus;
  onClearAll: () => void;
  onModerate: (
    entry: GuestbookEntry,
    status: Exclude<GuestbookStatus, 'pending'>,
  ) => void;
  onStatusChange: (status: GuestbookStatus) => void;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}

export function GuestbookModeration({
  busyKey,
  entries,
  status,
  onClearAll,
  onModerate,
  onStatusChange,
}: GuestbookModerationProps) {
  const handleClear = () => {
    if (window.confirm('Clear all guestbook entries? This cannot be undone.')) {
      onClearAll();
    }
  };

  return (
    <article id="guestbook" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">community</p>
          <h2>Guestbook</h2>
        </div>
        <div className="admin-toolbar">
          <select
            className="admin-select"
            value={status}
            onChange={(event) =>
              onStatusChange(event.target.value as GuestbookStatus)
            }
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          {status === 'pending' && entries.length > 0 && (
            <button
              className="admin-button danger"
              type="button"
              disabled={busyKey === 'guestbook-clear'}
              onClick={handleClear}
            >
              Clear all
            </button>
          )}
        </div>
      </div>
      <div className="entry-list">
        {entries.length === 0 && (
          <div className="admin-empty-state">
            <p className="admin-empty-icon">&#10003;</p>
            <p className="admin-empty">No {status} entries.</p>
          </div>
        )}
        {entries.map((entry) => (
          <article key={entry.id} className="entry-card">
            <header>
              <strong>{entry.name}</strong>
              <span className="pill">{entry.status}</span>
            </header>
            <p>{entry.message}</p>
            <p className="admin-entry-meta">
              {formatDate(entry.createdAt)}
              {entry.ipFingerprint
                ? ` \u00b7 ${truncate(entry.ipFingerprint, 12)}`
                : ''}
            </p>
            {entry.userAgent && (
              <p className="admin-entry-meta" title={entry.userAgent}>
                {truncate(entry.userAgent, 60)}
              </p>
            )}
            <div className="admin-entry-actions">
              {entry.status !== 'approved' && (
                <button
                  className="admin-button primary"
                  type="button"
                  disabled={busyKey === `guestbook-${entry.id}-approved`}
                  onClick={() => onModerate(entry, 'approved')}
                >
                  Approve
                </button>
              )}
              {entry.status !== 'rejected' && (
                <button
                  className="admin-button ghost"
                  type="button"
                  disabled={busyKey === `guestbook-${entry.id}-rejected`}
                  onClick={() => onModerate(entry, 'rejected')}
                >
                  Reject
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}
