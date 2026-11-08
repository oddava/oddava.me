import type { ComponentChild } from 'preact';
import './Skeleton.css';

export function SkeletonRow(): ComponentChild {
  return <div className="skeleton skeleton-row" aria-hidden="true" />;
}
