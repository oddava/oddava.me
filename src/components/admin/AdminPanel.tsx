import { useEffect, useRef, useState } from 'react';
import {
  clearGuestbookEntries,
  fetchAdminOverview,
  fetchGuestbookEntries,
  updateGuestbookEntryStatus,
  updateIntegrationSetting,
} from './api';
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
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const overviewRequestRef = useRef(0);

  const loadOverview = async () => {
    setOverview(await fetchAdminOverview());
  };

  const loadGuestbook = async (status: GuestbookStatus) => {
    setGuestbookEntries(await fetchGuestbookEntries(status));
  };

  useEffect(() => {
    let active = true;
    const requestId = ++overviewRequestRef.current;

    void fetchAdminOverview()
      .then((data) => {
        if (!active || requestId !== overviewRequestRef.current) return;
        setOverview(data);
        setGlobalError(null);
      })
      .catch((error) => {
        if (!active || requestId !== overviewRequestRef.current) return;
        setGlobalError(
          error instanceof Error ? error.message : 'Could not load admin data.',
        );
      })
      .finally(() => {
        if (requestId === overviewRequestRef.current) {
          setOverviewLoading(false);
        }
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

  const pendingCount = overview?.metrics.pendingGuestbook ?? 0;

  const handleToggleIntegration = async (
    key: string,
    name: string,
    enabled: boolean,
  ) => {
    setBusyKey(key);
    setNotice(null);
    setGlobalError(null);
    try {
      await updateIntegrationSetting(key, enabled);
      setNotice(`${name} integration ${enabled ? 'enabled' : 'disabled'}.`);
      await loadOverview();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : 'Request failed.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleCredentialsSaved = async () => {
    setBusyKey('spotify-credentials');
    setNotice(null);
    setGlobalError(null);
    try {
      await loadOverview();
      setNotice('Spotify credentials saved. Connection status refreshed.');
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : 'Request failed.',
      );
    } finally {
      setBusyKey(null);
    }
  };

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

      <MetricGrid overview={overview} />

      <section className="admin-split">
        <GuestbookModeration
          busyKey={busyKey}
          entries={guestbookEntries}
          status={guestbookStatus}
          onClearAll={handleClearGuestbook}
          onModerate={handleModerateGuestbookEntry}
          onStatusChange={setGuestbookStatus}
        />
        <IntegrationStatusList
          statuses={overview?.integrations ?? []}
          loading={overviewLoading}
          onToggle={handleToggleIntegration}
          onCredentialsSaved={handleCredentialsSaved}
          busyKey={busyKey}
        />
      </section>

      <KeystaticEditor keystaticHref={keystaticHref} />
    </div>
  );
}
