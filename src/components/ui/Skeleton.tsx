import type { ComponentChild } from 'preact';
import './Skeleton.css';

interface SkeletonGridProps {
  cols?: 2 | 4;
  rows?: number;
  ariaLabel?: string;
}

export function SkeletonRow(): ComponentChild {
  return <div className="skeleton skeleton-row" aria-hidden="true" />;
}

export function SkeletonGrid({
  cols = 4,
  rows = 1,
  ariaLabel = 'Loading metrics',
}: SkeletonGridProps): ComponentChild {
  const supportedColumns = cols === 2 ? 2 : 4;
  return (
    <section
      className={`admin-grid cols-${supportedColumns}`}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      {Array.from({ length: supportedColumns * rows }).map((_, index) => (
        <div
          className="skeleton skeleton-card"
          key={index}
          aria-hidden="true"
        />
      ))}
    </section>
  );
}
