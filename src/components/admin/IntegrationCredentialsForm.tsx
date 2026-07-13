import { useState } from 'preact/hooks';
import {
  revokeIntegrationCredentials,
  saveIntegrationCredentials,
} from './api';
import type {
  CredentialFieldStatus,
  IntegrationStatus,
} from '../../lib/contracts';
import { useDialogConfirm } from './useDialogConfirm';

interface IntegrationCredentialsFormProps {
  integration: IntegrationStatus;
  onSaved: (integration: IntegrationStatus) => void;
}

const ERROR_REGION_ID = 'integration-credentials-error';

function sourceLabel(status: CredentialFieldStatus | undefined): string {
  if (!status?.set) return 'not set';
  return status.source === 'env' ? 'set from environment' : 'set';
}

/**
 * Fields are rendered from the definitions the server sends, so a new
 * integration needs no changes here — it just appears with its own fields.
 */
export function IntegrationCredentialsForm({
  integration,
  onSaved,
}: IntegrationCredentialsFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useDialogConfirm();

  const statusByKey = new Map(
    integration.credentials.map((status) => [status.key, status]),
  );
  const hasOverride = integration.credentials.some(
    (status) => status.source === 'override',
  );
  const hasChanges =
    cleared.size > 0 || Object.values(values).some((value) => value.trim());

  const run = async (
    action: () => Promise<{ integration: IntegrationStatus }>,
  ) => {
    setBusy(true);
    setError(null);
    setIssues({});

    try {
      const data = await action();
      setValues({});
      setCleared(new Set());
      onSaved(data.integration);
    } catch (err) {
      const failure = err as Error & {
        issues?: Array<{ path?: unknown[]; message?: string }>;
      };

      // Field-level validation errors belong next to their field, not in a
      // banner the operator has to map back onto the form themselves.
      if (Array.isArray(failure.issues)) {
        setIssues(
          Object.fromEntries(
            failure.issues.flatMap((issue) => {
              const key = issue.path?.[0];
              return typeof key === 'string' && issue.message
                ? [[key, issue.message]]
                : [];
            }),
          ),
        );
      }

      setError(failure.message || 'Could not save credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!hasChanges) return;

    const patch = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value.trim()),
    );
    for (const key of cleared) patch[key] = '';

    void run(() => saveIntegrationCredentials(integration.id, patch));
  };

  const handleRevoke = async () => {
    const ok = await confirm({
      title: `Revoke ${integration.name} credentials`,
      message: `Delete every stored ${integration.name} credential? Values supplied through the deployment environment will remain in effect.`,
      confirmLabel: 'Yes, revoke',
      danger: true,
    });
    if (!ok) return;

    void run(() => revokeIntegrationCredentials(integration.id));
  };

  return (
    <form className="admin-credentials" onSubmit={handleSubmit}>
      <p className="admin-credentials__hint">
        Stored in persistent storage and never sent back to this form. Leave a
        field blank to keep its current value. Clear a stored override
        explicitly when you want the environment fallback to take over. Saving
        runs a live connection test.
      </p>

      <div className="admin-credentials__grid">
        {integration.fields.map((field) => {
          const status = statusByKey.get(field.key);
          const issue = issues[field.key];

          return (
            <label className="admin-credentials__field" key={field.key}>
              <span className="admin-credentials__label">
                {field.label}
                {!field.required && (
                  <span className="admin-credentials__optional">optional</span>
                )}
              </span>
              <input
                className="admin-input"
                type={field.kind === 'secret' ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.key] ?? ''}
                placeholder={
                  cleared.has(field.key)
                    ? 'Will clear on save'
                    : status?.set
                      ? '•••••••• set'
                      : 'Not set'
                }
                disabled={busy}
                aria-invalid={issue ? true : undefined}
                aria-describedby={
                  issue
                    ? `${ERROR_REGION_ID}-${field.key}`
                    : field.help
                      ? `${field.key}-help`
                      : undefined
                }
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setValues((current) => ({
                    ...current,
                    [field.key]: value,
                  }));
                  if (value) {
                    setCleared((current) => {
                      const next = new Set(current);
                      next.delete(field.key);
                      return next;
                    });
                  }
                }}
              />
              {issue ? (
                <span
                  className="admin-credentials__issue"
                  id={`${ERROR_REGION_ID}-${field.key}`}
                  role="alert"
                >
                  {issue}
                </span>
              ) : (
                <span className="admin-credentials__status">
                  {cleared.has(field.key)
                    ? 'stored override will be cleared'
                    : sourceLabel(status)}
                  {field.help && (
                    <span
                      className="admin-credentials__help"
                      id={`${field.key}-help`}
                    >
                      {field.help}
                    </span>
                  )}
                  {status?.source === 'override' && (
                    <button
                      type="button"
                      className="admin-credentials__clear"
                      disabled={busy}
                      onClick={() => {
                        setValues((current) => ({
                          ...current,
                          [field.key]: '',
                        }));
                        setCleared((current) => {
                          const next = new Set(current);
                          if (next.has(field.key)) next.delete(field.key);
                          else next.add(field.key);
                          return next;
                        });
                      }}
                    >
                      {cleared.has(field.key)
                        ? 'Keep stored value'
                        : 'Clear stored value'}
                    </button>
                  )}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {error && (
        <p
          id={ERROR_REGION_ID}
          className="admin-error admin-credentials__error"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </p>
      )}

      <div className="admin-credentials__actions">
        {hasOverride && (
          <button
            type="button"
            className="admin-button admin-button--ghost admin-button--danger"
            disabled={busy}
            onClick={() => void handleRevoke()}
          >
            Revoke stored credentials
          </button>
        )}
        <button
          type="submit"
          className="admin-button"
          disabled={busy || !hasChanges}
        >
          {busy ? 'Saving…' : 'Save & test'}
        </button>
      </div>

      {dialog}
    </form>
  );
}
