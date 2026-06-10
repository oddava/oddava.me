import { useEffect, useMemo, useState } from 'react';
import './AdminPanel.css';

type GuestbookStatus = 'pending' | 'approved' | 'rejected';

interface IntegrationStatus {
  name: string;
  healthy: boolean;
  detail: string;
}

interface OverviewResponse {
  metrics: {
    posts: number;
    drafts: number;
    projects: number;
    featuredProjects: number;
    pendingGuestbook: number;
    approvedGuestbook: number;
  };
  integrations: IntegrationStatus[];
}

interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

interface GuestbookResponse {
  entries: GuestbookEntry[];
}

interface AdminPanelProps {
  keystaticHref: string;
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminPanel({ keystaticHref }: AdminPanelProps) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [guestbookStatus, setGuestbookStatus] = useState<GuestbookStatus>('pending');
  const [guestbookEntries, setGuestbookEntries] = useState<GuestbookEntry[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = async () => {
    const data = await readJson<OverviewResponse>('/api/admin/overview', { cache: 'no-store' });
    setOverview(data);
  };

  const loadGuestbook = async (status: GuestbookStatus) => {
    const data = await readJson<GuestbookResponse>(`/api/guestbook/admin?status=${status}`, { cache: 'no-store' });
    setGuestbookEntries(data.entries);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await Promise.all([loadOverview(), loadGuestbook('pending')]);
        if (!active) return;
        setGlobalError(null);
      } catch (error) {
        if (!active) return;
        setGlobalError(error instanceof Error ? error.message : 'Could not load admin data.');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadGuestbook(guestbookStatus).catch((error) => {
      setGlobalError(error instanceof Error ? error.message : 'Could not load guestbook entries.');
    });
  }, [guestbookStatus]);

  async function runAction(key: string, fn: () => Promise<void>, successMessage: string) {
    setBusyKey(key);
    setNotice(null);
    setGlobalError(null);
    try {
      await fn();
      setNotice(successMessage);
      await loadOverview();
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusyKey(null);
    }
  }

  const overviewCards = useMemo(() => {
    if (!overview) return [];
    return [
      { label: 'Posts', value: overview.metrics.posts },
      { label: 'Drafts', value: overview.metrics.drafts },
      { label: 'Projects', value: overview.metrics.projects },
      { label: 'Featured', value: overview.metrics.featuredProjects },
      { label: 'Pending notes', value: overview.metrics.pendingGuestbook },
      { label: 'Approved notes', value: overview.metrics.approvedGuestbook },
    ];
  }, [overview]);

  return (
    <div className="admin-dashboard">
      {globalError && <p className="admin-error" role="alert">{globalError}</p>}
      {notice && <p className="admin-success" role="status" aria-live="polite">{notice}</p>}

      <nav className="admin-anchor-nav admin-card">
        <a href="#content">Content</a>
        <a href="#guestbook">Guestbook</a>
        <a href="#integrations">Integrations</a>
      </nav>

      <section className="admin-grid cols-4">
        {overviewCards.map((card) => (
          <article key={card.label} className="admin-card metric-card">
            <span className="metric-card__label">{card.label}</span>
            <strong className="metric-card__value">{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-split">
        <article id="content" className="admin-card admin-panel">
          <div className="admin-section-head">
            <div>
              <p className="admin-kicker">content</p>
              <h2>Content management</h2>
              <p>Keystatic stays the editor for MDX content, but it now lives inside the main admin workflow.</p>
            </div>
          </div>
          {overview && (
            <div className="content-list">
              <div className="content-card">
                <header>
                  <strong>Blog</strong>
                  <span className="pill">{overview.metrics.posts} total</span>
                </header>
                <p className="admin-muted">{overview.metrics.drafts} drafts currently hidden from the public site.</p>
              </div>
              <div className="content-card">
                <header>
                  <strong>Projects</strong>
                  <span className="pill">{overview.metrics.projects} total</span>
                </header>
                <p className="admin-muted">{overview.metrics.featuredProjects} projects are marked featured.</p>
              </div>
            </div>
          )}
          <div className="admin-content-links">
            <a className="admin-button primary" href="#content-editor">Jump to editor</a>
            <a className="admin-button ghost" href={keystaticHref} target="_blank" rel="noreferrer">Open raw Keystatic</a>
            <a className="admin-button ghost" href="/blog">View blog</a>
            <a className="admin-button ghost" href="/projects">View projects</a>
          </div>
        </article>

        <article id="integrations" className="admin-card admin-panel">
          <div className="admin-section-head">
            <div>
              <p className="admin-kicker">health</p>
              <h2>Integrations</h2>
              <p>Quick configuration and readiness readout for the services this site depends on.</p>
            </div>
          </div>
          <div className="status-list">
            {overview?.integrations.map((status) => (
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
      </section>

      <section id="content-editor" className="admin-card admin-panel admin-editor-panel">
        <div className="admin-section-head">
          <div>
            <p className="admin-kicker">editor</p>
            <h2>Embedded Keystatic</h2>
            <p>Edit blog posts and projects without leaving the unified admin panel.</p>
          </div>
        </div>
        <div className="admin-iframe-shell">
          <iframe
            title="Keystatic content editor"
            src={keystaticHref}
            className="admin-iframe"
          />
        </div>
      </section>

      <section className="admin-grid">
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
                value={guestbookStatus}
                onChange={(event) => setGuestbookStatus(event.target.value as GuestbookStatus)}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <button
                className="admin-button danger"
                type="button"
                disabled={busyKey === 'guestbook-clear'}
                onClick={() =>
                  void runAction(
                    'guestbook-clear',
                    async () => {
                      await readJson('/api/guestbook/admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'clear', all: true }),
                      });
                      await loadGuestbook(guestbookStatus);
                    },
                    'Guestbook cleared.',
                  )
                }
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="entry-list">
            {guestbookEntries.length === 0 && <p className="admin-empty">No entries in this state.</p>}
            {guestbookEntries.map((entry) => (
              <article key={entry.id} className="entry-card">
                <header>
                  <strong>{entry.name}</strong>
                  <span className="pill">{entry.status}</span>
                </header>
                <p>{entry.message}</p>
                <p className="admin-entry-meta">
                  {formatDate(entry.createdAt)}
                  {entry.ipFingerprint ? ` • ${entry.ipFingerprint.slice(0, 12)}...` : ''}
                </p>
                {entry.userAgent && <p className="admin-entry-meta">{entry.userAgent}</p>}
                <div className="admin-entry-actions">
                  {entry.status !== 'approved' && (
                    <button
                      className="admin-button primary"
                      type="button"
                      disabled={busyKey === `guestbook-${entry.id}-approved`}
                      onClick={() =>
                        void runAction(
                          `guestbook-${entry.id}-approved`,
                          async () => {
                            await readJson('/api/guestbook/admin', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: entry.id, status: 'approved' }),
                            });
                            await loadGuestbook(guestbookStatus);
                          },
                          'Guestbook entry approved.',
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
                  {entry.status !== 'rejected' && (
                    <button
                      className="admin-button ghost"
                      type="button"
                      disabled={busyKey === `guestbook-${entry.id}-rejected`}
                      onClick={() =>
                        void runAction(
                          `guestbook-${entry.id}-rejected`,
                          async () => {
                            await readJson('/api/guestbook/admin', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: entry.id, status: 'rejected' }),
                            });
                            await loadGuestbook(guestbookStatus);
                          },
                          'Guestbook entry rejected.',
                        )
                      }
                    >
                      Reject
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </article>

      </section>
    </div>
  );
}
