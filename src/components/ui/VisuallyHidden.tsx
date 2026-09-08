import type { ComponentChildren } from 'preact';
import './VisuallyHidden.css';

interface VisuallyHiddenProps {
  children: ComponentChildren;
  as?: 'span' | 'label';
  className?: string;
}

export function VisuallyHidden({
  children,
  as = 'span',
  className,
}: VisuallyHiddenProps) {
  const Tag = as;
  return (
    <Tag className={['visually-hidden', className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  );
}
