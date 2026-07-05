import type { CSSProperties, ReactNode } from 'react';
import './Skeleton.css';

interface SkeletonGridProps {
  cols?: number;
  rows?: number;
  ariaLabel?: string;
}

export function SkeletonRow(): ReactNode {
  return <div className="skeleton skeleton-row" aria-hidden="true" />;
}

export function SkeletonCard(): ReactNode {
  return <div className="skeleton skeleton-card" aria-hidden="true" />;
}

export function SkeletonGrid({
  cols = 4,
  rows = 1,
  ariaLabel = 'Loading metrics',
}: SkeletonGridProps): ReactNode {
  const style = {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  } satisfies CSSProperties as CSSProperties;
  return (
    <section
      className="admin-grid"
      style={style}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      {Array.from({ length: cols * rows }).map((_, index) => (
        <div
          className="skeleton skeleton-card"
          key={index}
          aria-hidden="true"
        />
      ))}
    </section>
  );
}
