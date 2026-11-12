import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchIntegrations, testIntegration, toggleIntegration } from './api';
import { SkeletonRow } from '../ui/Skeleton';
import type { IntegrationState, IntegrationStatus } from '../../lib/contracts';
import { errorMessage, useToast } from './toast';

const STATE_LABEL: Record<IntegrationState, string> = {
  ok: 'ok',
  degraded: 'degraded',
  error: 'error',
  unconfigured: 'needs setup',
  disabled: 'off',
};

/**
 * `degraded` and `unconfigured` share the warning tone: both mean "working as
 * configured, but not doing what you probably want", a different call to
 * action than a hard failure.
 */
const STATE_TONE: Record<IntegrationState, string> = {
  ok: 'good',
  degraded: 'warn',
  error: 'bad',
  unconfigured: 'warn',
  disabled: 'off',
};

/** Worth a dot in the navigation: switched on, but not working. */
export function needsAttention(integration: IntegrationStatus): boolean {
  return (
    integration.enabled &&
    (integration.state === 'error' ||
      integration.state === 'degraded' ||
      integration.state === 'unconfigured')
  );
}

function formatCheckedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  const checkedAt = new Date(iso).getTime();
  if (Number.isNaN(checkedAt)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - checkedAt) / 1000));
  if (seconds < 60) return 'checked just now';
  if (seconds < 3600) return `checked ${Math.round(seconds / 60)}m ago`;
  return `checked ${Math.round(seconds / 3600)}h ago`;
}

interface IntegrationsPanelProps {
  onAttention?: (attention: boolean) => void;
}

export function IntegrationsPanel({ onAttention }: IntegrationsPanelProps) {
  const toast = useToast();
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; kind: 'test' | 'toggle' }>();
  /** The row whose test just passed; its button says so for a moment. */
  const [passed, setPassed] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(errorMessage(err, 'could not load integrations.'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    onAttention?.(integrations.some(needsAttention));
  }, [integrations, onAttention]);

  /** Replaces one row, so one integration's result never clobbers another's. */
  const replace = (next: IntegrationStatus) =>
    setIntegrations((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );

  /**
   * A switch takes effect at once — that is what a switch promises — and
   * flipping it back is its own undo, offered in the message too.
   */
  const setEnabled = async (
    integration: IntegrationStatus,
    enabled: boolean,
    { offerUndo = true } = {},
  ) => {
    setBusy({ id: integration.id, kind: 'toggle' });
    try {
      const { integration: result } = await toggleIntegration(
        integration.id,
        enabled,
      );
      if (!mounted.current) return;
      replace(result);
      toast.show({
        message: `${result.name} ${result.enabled ? 'enabled' : 'disabled'}.`,
        undo: offerUndo
          ? () => setEnabled(result, !enabled, { offerUndo: false })
          : undefined,
      });
    } catch (err) {
      toast.show({
        message: errorMessage(err, 'could not change the integration.'),
        tone: 'error',
      });
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };

  const test = async (integration: IntegrationStatus) => {
    setBusy({ id: integration.id, kind: 'test' });
    try {
      const { integration: result } = await testIntegration(integration.id);
      if (!mounted.current) return;
      replace(result);
      // A pass answers on the button itself; the row already shows the
      // detail, so only a failure is worth a message.
      if (result.state === 'error') {
        toast.show({
          message: `${result.name}: ${result.detail}`,
          tone: 'error',
        });
      } else {
        setPassed(result.id);
        window.setTimeout(() => {
          if (mounted.current) setPassed(null);
        }, 2400);
      }
    } catch (err) {
      toast.show({
        message: errorMessage(err, 'the test could not run.'),
        tone: 'error',
      });
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };

  return (
    <section
      id="integrations"
      className="adm-section"
      aria-labelledby="integrations-title"
    >
      <header className="adm-head">
        <h2 id="integrations-title" className="adm-head__title">
          integrations
        </h2>
        <div className="adm-head__tools">
          <button
            type="button"
            className="adm-button adm-button--small adm-button--quiet"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading && integrations.length > 0 ? 'checking…' : 'check all'}
          </button>
        </div>
      </header>

      {loadError && integrations.length === 0 ? (
        <div className="adm-empty">
          <p className="adm-empty__line adm-empty__line--error" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="adm-button adm-button--small"
            onClick={() => void load()}
          >
            retry
          </button>
        </div>
      ) : loading && integrations.length === 0 ? (
        <div className="adm-skeletons" role="status" aria-label="loading">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <ul className="adm-list">
          {integrations.map((integration) => {
            const rowBusy = busy?.id === integration.id;
            const checkedAt = formatCheckedAt(integration.checkedAt);
            const tone = STATE_TONE[integration.state];
            return (
              <li className="adm-int" key={integration.id}>
                <div className="adm-int__body">
                  <p className="adm-int__heading">
                    <strong>{integration.name}</strong>
                    <span className={`adm-int__state adm-int__state--${tone}`}>
                      {STATE_LABEL[integration.state]}
                    </span>
                  </p>
                  <p className="adm-int__detail" aria-live="polite">
                    {integration.detail}
                  </p>
                  {checkedAt && <p className="adm-int__checked">{checkedAt}</p>}
                </div>
                <div className="adm-int__actions">
                  <button
                    type="button"
                    className={`adm-button adm-button--small ${
                      passed === integration.id ? 'is-passed' : ''
                    }`}
                    disabled={rowBusy || !integration.enabled}
                    title={
                      integration.enabled
                        ? 'Run a live connection test'
                        : 'Switch it on to test it'
                    }
                    aria-label={`Test ${integration.name}`}
                    onClick={() => void test(integration)}
                  >
                    {rowBusy && busy?.kind === 'test'
                      ? 'testing…'
                      : passed === integration.id
                        ? 'passed'
                        : 'test'}
                  </button>
                  {integration.manageable && (
                    <button
                      type="button"
                      role="switch"
                      className="adm-switch"
                      aria-checked={integration.enabled}
                      aria-label={integration.name}
                      disabled={rowBusy}
                      onClick={() =>
                        void setEnabled(integration, !integration.enabled)
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
