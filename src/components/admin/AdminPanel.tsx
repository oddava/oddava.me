import { useEffect, useMemo, useState } from 'react';
import './AdminPanel.css';

type GuestbookStatus = 'pending' | 'approved' | 'rejected';
type Difficulty = 'easy' | 'medium' | 'hard';

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
    clickCount: number;
    leaderboardSummary: Record<Difficulty, number>;
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

interface LeaderboardEntry {
  time: number;
  createdAt: string;
}

interface LeaderboardResponse {
  difficulty: Difficulty;
  entries: LeaderboardEntry[];
}

interface AdminPanelProps {
  keystaticHref: string;
}

const difficultyOrder: Difficulty[] = ['easy', 'medium', 'hard'];

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
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [clickerCount, setClickerCount] = useState('0');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = async () => {
    const data = await readJson<OverviewResponse>('/api/admin/overview', { cache: 'no-store' });
    setOverview(data);
    setClickerCount(String(data.metrics.clickCount));
  };

  const loadGuestbook = async (status: GuestbookStatus) => {
    const data = await readJson<GuestbookResponse>(`/api/guestbook/admin?status=${status}`, { cache: 'no-store' });
    setGuestbookEntries(data.entries);
  };

  const loadLeaderboard = async (nextDifficulty: Difficulty) => {
    const data = await readJson<LeaderboardResponse>(`/api/admin/minesweeper?difficulty=${nextDifficulty}`, {
      cache: 'no-store',
    });
    setLeaderboardEntries(data.entries);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await Promise.all([loadOverview(), loadGuestbook('pending'), loadLeaderboard('easy')]);
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

  useEffect(() => {
    void loadLeaderboard(difficulty).catch((error) => {
      setGlobalError(error instanceof Error ? error.message : 'Could not load leaderboard.');
    });
  }, [difficulty]);

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
      { label: 'Click count', value: overview.metrics.clickCount },
      {
        label: 'Leaderboard rows',
        value: difficultyOrder.reduce((sum, level) => sum + (overview.metrics.leaderboardSummary[level] ?? 0), 0),
      },
    ];
  }, [overview]);

  return (
    <div className="admin-dashboard">
      {globalError && <p className="admin-error">{globalError}</p>}
      {notice && <p className="admin-success">{notice}</p>}

      <nav className="admin-anchor-nav admin-card">
        <a href="#content">Content</a>
        <a href="#guestbook">Guestbook</a>
        <a href="#clicker">Clicker</a>
        <a href="#minesweeper">Minesweeper</a>
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

      <section className="admin-split">
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
                        body: JSON.stringify({ action: 'delete', all: true }),
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
                  <button
                    className="admin-button danger"
                    type="button"
                    disabled={busyKey === `guestbook-${entry.id}-delete`}
                    onClick={() =>
                      void runAction(
                        `guestbook-${entry.id}-delete`,
                        async () => {
                          await readJson('/api/guestbook/admin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'delete', id: entry.id }),
                          });
                          await loadGuestbook(guestbookStatus);
                        },
                        'Guestbook entry deleted.',
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>

        <div className="admin-grid">
          <article id="clicker" className="admin-card admin-panel">
            <div className="admin-section-head">
              <div>
                <p className="admin-kicker">community</p>
                <h2>Clicker</h2>
                <p>Inspect and override the shared counter state.</p>
              </div>
            </div>
            <form
              className="admin-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runAction(
                  'clicker-set',
                  async () => {
                    const next = await readJson<{ count: number }>('/api/admin/clicker', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ count: Number(clickerCount) }),
                    });
                    setClickerCount(String(next.count));
                  },
                  'Clicker count updated.',
                );
              }}
            >
              <input
                className="admin-input"
                type="number"
                min="0"
                value={clickerCount}
                onChange={(event) => setClickerCount(event.target.value)}
              />
              <button className="admin-button primary" type="submit" disabled={busyKey === 'clicker-set'}>
                Set count
              </button>
              <button
                className="admin-button ghost"
                type="button"
                disabled={busyKey === 'clicker-reset'}
                onClick={() =>
                  void runAction(
                    'clicker-reset',
                    async () => {
                      await readJson('/api/admin/clicker', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ count: 0 }),
                      });
                      setClickerCount('0');
                    },
                    'Clicker reset to zero.',
                  )
                }
              >
                Reset
              </button>
            </form>
          </article>

          <article id="minesweeper" className="admin-card admin-panel">
            <div className="admin-section-head">
              <div>
                <p className="admin-kicker">games</p>
                <h2>Minesweeper leaderboard</h2>
                <p>Review or clear leaderboard entries per difficulty.</p>
              </div>
              <select
                className="admin-select"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as Difficulty)}
              >
                {difficultyOrder.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
            <div className="admin-entry-actions" style={{ marginTop: 0, marginBottom: 16 }}>
              <button
                className="admin-button danger"
                type="button"
                disabled={busyKey === `clear-${difficulty}`}
                onClick={() =>
                  void runAction(
                    `clear-${difficulty}`,
                    async () => {
                      await readJson('/api/admin/minesweeper', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete', difficulty, clearAll: true }),
                      });
                      await loadLeaderboard(difficulty);
                    },
                    `Cleared ${difficulty} leaderboard.`,
                  )
                }
              >
                Clear {difficulty}
              </button>
            </div>
            {leaderboardEntries.length === 0 ? (
              <p className="admin-empty">No leaderboard entries for this difficulty.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardEntries.map((entry) => (
                    <tr key={`${entry.createdAt}-${entry.time}`}>
                      <td className="admin-kbd">{entry.time}s</td>
                      <td>{formatDate(entry.createdAt)}</td>
                      <td>
                        <button
                          className="admin-button danger"
                          type="button"
                          disabled={busyKey === `${difficulty}-${entry.createdAt}`}
                          onClick={() =>
                            void runAction(
                              `${difficulty}-${entry.createdAt}`,
                              async () => {
                                await readJson('/api/admin/minesweeper', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    action: 'delete',
                                    difficulty,
                                    createdAt: entry.createdAt,
                                    time: entry.time,
                                  }),
                                });
                                await loadLeaderboard(difficulty);
                              },
                              'Leaderboard entry removed.',
                            )
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
