import type { OverviewResponse } from '../../lib/contracts';
import { SkeletonGrid } from './Skeleton';

interface MetricGridProps {
  overview: OverviewResponse | null;
  error?: string | null;
  onRetry?: () => void;
}

export function MetricGrid({ overview, error, onRetry }: MetricGridProps) {
  // Counters that never arrived and counters still loading look identical as
  // skeletons, so a failed load has to say so — otherwise the placeholders read
  // as a slow request forever and the operator has nothing to act on.
  if (!overview && error) {
    return (
      <section className="admin-grid">
        <article className="admin-card">
          <div className="admin-empty-state">
            <p className="admin-error" role="alert">
              {error}
            </p>
            {onRetry && (
              <button
                type="button"
                className="admin-button admin-button--ghost"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        </article>
      </section>
    );
  }

  if (!overview) {
    return <SkeletonGrid cols={2} rows={1} ariaLabel="Loading metrics" />;
  }

  const cards = [
    { label: 'Notes', value: overview.metrics.notes },
    { label: 'Pending guestbook', value: overview.metrics.pendingGuestbook },
  ];

  return (
    <section className="admin-grid cols-2">
      {cards.map((card) => (
        <article key={card.label} className="admin-card metric-card">
          <span className="metric-card__label">{card.label}</span>
          <strong className="metric-card__value">{card.value}</strong>
        </article>
      ))}
    </section>
  );
}
