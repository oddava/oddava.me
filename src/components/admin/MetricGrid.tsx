import type { OverviewResponse } from './types';

interface MetricGridProps {
  overview: OverviewResponse | null;
}

export function MetricGrid({ overview }: MetricGridProps) {
  const cards = overview
    ? [
        { label: 'Posts', value: overview.metrics.posts },
        { label: 'Drafts', value: overview.metrics.drafts },
        { label: 'Projects', value: overview.metrics.projects },
        { label: 'Featured', value: overview.metrics.featuredProjects },
        { label: 'Pending notes', value: overview.metrics.pendingGuestbook },
        { label: 'Approved notes', value: overview.metrics.approvedGuestbook },
      ]
    : [];

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
