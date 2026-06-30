import { useEffect, useMemo, useState } from 'react';
import {
  clearGuestbookEntries,
  fetchAdminOverview,
  fetchGuestbookEntries,
  updateGuestbookEntryStatus,
} from './api';
import { ContentManagement } from './ContentManagement';
import { GuestbookModeration } from './GuestbookModeration';
import { IntegrationStatusList } from './IntegrationStatusList';
import { KeystaticEditor } from './KeystaticEditor';
import { MetricGrid } from './MetricGrid';
import type {
  GuestbookEntry,
  GuestbookStatus,
  OverviewResponse,
} from './types';
import './AdminPanel.css';

interface AdminPanelProps {
  keystaticHref: string;
}

export default function AdminPanel({ keystaticHref }: AdminPanelProps) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [guestbookStatus, setGuestbookStatus] =
    useState<GuestbookStatus>('pending');
  const [guestbookEntries, setGuestbookEntries] = useState<GuestbookEntry[]>(
    [],
  );
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const contentMetrics = useMemo(() => {
    if (!overview) return null;
    return {
      posts: overview.metrics.posts,
      drafts: overview.metrics.drafts,
      projects: overview.metrics.projects,
      featuredProjects: overview.metrics.featuredProjects,
    };
  }, [overview]);

  const loadOverview = async () => {
    setOverview(await fetchAdminOverview());
  };

  const loadGuestbook = async (status: GuestbookStatus) => {
    setGuestbookEntries(await fetchGuestbookEntries(status));
  };

  useEffect(() => {
    let active = true;

    void fetchAdminOverview()
      .then((data) => {
        if (!active) return;
        setOverview(data);
        setGlobalError(null);
      })
      .catch((error) => {
        if (!active) return;
        setGlobalError(
          error instanceof Error ? error.message : 'Could not load admin data.',
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    void fetchGuestbookEntries(guestbookStatus)
      .then((entries) => {
        if (!active) return;
        setGuestbookEntries(entries);
        setGlobalError(null);
      })
      .catch((error) => {
        if (!active) return;
        setGlobalError(
          error instanceof Error
            ? error.message
            : 'Could not load guestbook entries.',
        );
      });

    return () => {
      active = false;
    };
  }, [guestbookStatus]);

  async function runAction(
    key: string,
    action: () => Promise<void>,
    successMessage: string,
  ) {
    setBusyKey(key);
    setNotice(null);
    setGlobalError(null);
    try {
      await action();
      setNotice(successMessage);
      await loadOverview();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : 'Request failed.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  const handleClearGuestbook = () =>
    runAction(
      'guestbook-clear',
      async () => {
        await clearGuestbookEntries();
        await loadGuestbook(guestbookStatus);
      },
      'Guestbook cleared.',
    );

  const handleModerateGuestbookEntry = (
    entry: GuestbookEntry,
    status: Exclude<GuestbookStatus, 'pending'>,
  ) =>
    runAction(
      `guestbook-${entry.id}-${status}`,
      async () => {
        await updateGuestbookEntryStatus(entry.id, status);
        await loadGuestbook(guestbookStatus);
      },
      `Guestbook entry ${status}.`,
    );

  return (
    <div className="admin-dashboard">
      {globalError && (
        <p className="admin-error" role="alert">
          {globalError}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      <nav className="admin-anchor-nav admin-card">
        <a href="#content">Content</a>
        <a href="#guestbook">Guestbook</a>
        <a href="#integrations">Integrations</a>
      </nav>

      <MetricGrid overview={overview} />

      <section className="admin-split">
        <ContentManagement
          metrics={contentMetrics}
          keystaticHref={keystaticHref}
        />
        <IntegrationStatusList statuses={overview?.integrations ?? []} />
      </section>

      <KeystaticEditor keystaticHref={keystaticHref} />

      <section className="admin-grid">
        <GuestbookModeration
          busyKey={busyKey}
          entries={guestbookEntries}
          status={guestbookStatus}
          onClearAll={handleClearGuestbook}
          onModerate={handleModerateGuestbookEntry}
          onStatusChange={setGuestbookStatus}
        />
      </section>
    </div>
  );
}
