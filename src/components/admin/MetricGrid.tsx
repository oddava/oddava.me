import type { OverviewResponse } from './types';
import { SkeletonGrid } from './Skeleton';

interface MetricGridProps {
  overview: OverviewResponse | null;
}

export function MetricGrid({ overview }: MetricGridProps) {
  if (!overview) {
    return <SkeletonGrid cols={2} rows={1} ariaLabel="Loading metrics" />;
  }

  const cards = [
    { label: 'Notes', value: overview.metrics.notes },
    { label: 'Drafts', value: overview.metrics.drafts },
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
