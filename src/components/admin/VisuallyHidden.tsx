import type { CSSProperties, ReactNode } from 'react';

const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  clipPath: 'inset(50%)',
  border: '0',
  padding: '0',
  margin: '-1px',
};

interface VisuallyHiddenProps {
  children: ReactNode;
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
    <Tag className={className} style={visuallyHiddenStyle}>
      {children}
    </Tag>
  );
}

export { visuallyHiddenStyle };