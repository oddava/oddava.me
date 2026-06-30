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

export function GuestbookModeration({
  busyKey,
  entries,
  status,
  onClearAll,
  onModerate,
  onStatusChange,
}: GuestbookModerationProps) {
  return (
    <article id="guestbook" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">moderation</p>
          <h2>Guestbook</h2>
          <p>Review notes before they reach the public page.</p>
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
          <button
            className="admin-button danger"
            type="button"
            disabled={busyKey === 'guestbook-clear'}
            onClick={onClearAll}
          >
            Clear all
          </button>
        </div>
      </div>
      <div className="entry-list">
        {entries.length === 0 && (
          <p className="admin-empty">No entries in this state.</p>
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
                ? ` - ${entry.ipFingerprint.slice(0, 12)}...`
                : ''}
            </p>
            {entry.userAgent && (
              <p className="admin-entry-meta">{entry.userAgent}</p>
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
