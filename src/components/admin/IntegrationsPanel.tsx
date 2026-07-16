import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchIntegrations, testIntegration, toggleIntegration } from './api';
import { SkeletonRow } from './Skeleton';
import type { IntegrationState, IntegrationStatus } from '../../lib/contracts';
import { useDialogConfirm } from './useDialogConfirm';
import { VisuallyHidden } from './VisuallyHidden';

const STATE_LABEL: Record<IntegrationState, string> = {
  ok: 'ok',
  degraded: 'degraded',
  error: 'error',
  unconfigured: 'setup',
  disabled: 'off',
};

/**
 * `degraded` and `unconfigured` deliberately share the warning treatment: both
 * mean "working as configured, but not doing what you probably want", which is
 * a different call to action than a hard failure.
 */
const STATE_CLASS: Record<IntegrationState, string> = {
  ok: 'pill good',
  degraded: 'pill warn',
  error: 'pill bad',
  unconfigured: 'pill warn',
  disabled: 'pill',
};

function formatCheckedAt(iso: string | undefined): string | null {
  if (!iso) return null;

  const checkedAt = new Date(iso).getTime();
  if (Number.isNaN(checkedAt)) return null;

  const seconds = Math.max(0, Math.round((Date.now() - checkedAt) / 1000));
  if (seconds < 60) return 'checked just now';
  if (seconds < 3600) return `checked ${Math.round(seconds / 60)}m ago`;
  return `checked ${Math.round(seconds / 3600)}h ago`;
}

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useDialogConfirm();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      if (!mounted.current) return;
      setIntegrations(data.integrations);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(
        err instanceof Error ? err.message : 'Could not load integrations.',
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** Replaces a single row, so one integration's result never clobbers another's. */
  const replace = (next: IntegrationStatus) => {
    setIntegrations((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  };

  const run = async (
    id: string,
    action: () => Promise<{ integration: IntegrationStatus }>,
    describe: (integration: IntegrationStatus) => string,
  ) => {
    setBusyId(id);
    setNotice(null);
    setError(null);

    try {
      const data = await action();
      if (!mounted.current) return;
      replace(data.integration);
      setNotice(describe(data.integration));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };

  const handleToggle = async (integration: IntegrationStatus) => {
    const next = !integration.enabled;
    const ok = await confirm({
      title: next ? 'Enable integration' : 'Disable integration',
      message: next
        ? `Enable ${integration.name}?`
        : `Disable ${integration.name}? The site will stop making any requests to it.`,
      confirmLabel: next ? 'Yes, enable' : 'Yes, disable',
      danger: !next,
    });
    if (!ok) return;

    void run(
      integration.id,
      () => toggleIntegration(integration.id, next),
      (result) => `${result.name} ${result.enabled ? 'enabled' : 'disabled'}.`,
    );
  };

  const handleTest = (integration: IntegrationStatus) =>
    void run(
      integration.id,
      () => testIntegration(integration.id),
      (result) => `${result.name}: ${result.detail}`,
    );

  return (
    <article id="integrations" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">connections</p>
          <h2>Integrations</h2>
        </div>
        <button
          type="button"
          className="admin-button admin-button--ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      <div className="admin-integration-list">
        {loading && integrations.length === 0 && (
          <div
            className="admin-integration-list__skeletons"
            role="status"
            aria-live="polite"
          >
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}

        {!loading && integrations.length === 0 && (
          <div className="admin-empty-state" role="status">
            <p className="admin-empty">
              Integration statuses are unavailable right now.
            </p>
            <button
              type="button"
              className="admin-button admin-button--ghost"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        )}

        {integrations.map((integration) => {
          const busy = busyId === integration.id;
          const checkedAt = formatCheckedAt(integration.checkedAt);
          const toggleId = `integration-toggle-${integration.id}`;

          return (
            <div className="admin-integration-row" key={integration.id}>
              <div className="admin-integration-row__info">
                <div className="admin-integration-row__heading">
                  <span className="admin-integration-row__name">
                    {integration.name}
                  </span>
                  <span className={STATE_CLASS[integration.state]}>
                    {STATE_LABEL[integration.state]}
                  </span>
                  {checkedAt && (
                    <span className="admin-integration-row__checked">
                      {checkedAt}
                    </span>
                  )}
                </div>
                <p className="admin-integration-row__detail">
                  {integration.detail}
                </p>
              </div>

              <div className="admin-integration-row__actions">
                <button
                  type="button"
                  className="admin-button admin-button--ghost"
                  disabled={busy || !integration.enabled}
                  title={
                    integration.enabled
                      ? 'Run a live connection test'
                      : 'Enable the integration to test it'
                  }
                  onClick={() => handleTest(integration)}
                >
                  {busy ? 'Testing…' : 'Test'}
                </button>

                {integration.manageable && (
                  <label
                    className={`admin-toggle ${
                      integration.enabled ? 'admin-toggle--on' : ''
                    }`}
                    htmlFor={toggleId}
                    title={
                      integration.enabled
                        ? 'Enabled — click to disable'
                        : 'Disabled — click to enable'
                    }
                  >
                    <input
                      id={toggleId}
                      type="checkbox"
                      checked={integration.enabled}
                      disabled={busy}
                      onChange={() => void handleToggle(integration)}
                    />
                    <span className="admin-toggle__track">
                      <span className="admin-toggle__thumb" />
                    </span>
                    <VisuallyHidden>
                      {integration.name} integration toggle, currently{' '}
                      {integration.enabled ? 'enabled' : 'disabled'}
                    </VisuallyHidden>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dialog}
    </article>
  );
}
