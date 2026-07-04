import type { OverviewResponse } from './types';
import { SkeletonGrid } from './Skeleton';

interface MetricGridProps {
  overview: OverviewResponse | null;
}

export function MetricGrid({ overview }: MetricGridProps) {
  if (!overview) {
    return <SkeletonGrid cols={4} rows={1} ariaLabel="Loading metrics" />;
  }

  const cards = [
    { label: 'Posts', value: overview.metrics.posts },
    { label: 'Drafts', value: overview.metrics.drafts },
    { label: 'Projects', value: overview.metrics.projects },
    { label: 'Books', value: overview.metrics.books },
  ];

  return (
    <section className="admin-grid cols-4">
      {cards.map((card) => (
        <article key={card.label} className="admin-card metric-card">
          <span className="metric-card__label">{card.label}</span>
          <strong className="metric-card__value">{card.value}</strong>
        </article>
      ))}
    </section>
  );
}