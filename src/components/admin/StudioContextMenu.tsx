import { createPortal } from 'preact/compat';
import type { ComponentChildren, RefObject } from 'preact';
import type { MenuPosition } from './useStudioMenu';

interface Props {
  open: boolean;
  /** Named for screen readers: "Actions for my-note". */
  label: string;
  menuRef: RefObject<HTMLDivElement>;
  position: MenuPosition;
  children: ComponentChildren;
}

/** The popup behind every ••• button and right-click in the workspace. */
export default function StudioContextMenu({
  open,
  label,
  menuRef,
  position,
  children,
}: Props) {
  if (!open) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="studio-menu"
      role="menu"
      aria-label={label}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        // Hidden for the frame before its size is known, so it never flashes
        // half off the screen.
        visibility: position.measured ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
