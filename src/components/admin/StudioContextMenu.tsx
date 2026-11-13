import { createPortal } from 'preact/compat';
import type { ComponentChildren, RefObject } from 'preact';
import type { MenuPosition } from './useStudioMenu';
import { Icon, type IconName } from './studioIcons';

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
      data-studio-layer="menu"
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

/**
 * One row of a menu: an icon, the action, and the key that does the same
 * thing. Rows without an icon keep its space, so every label in a menu
 * starts on the same line.
 */
export function MenuItem({
  icon,
  label,
  hint,
  danger,
  disabled,
  checked,
  onClick,
}: {
  icon?: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Set for a choice among options: the row becomes a menuitemradio. */
  checked?: boolean;
  onClick: () => void;
}) {
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      className={`studio-menu__item ${danger ? 'is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : <span className="studio-menu__icon-gap" />}
      <span className="studio-menu__label">{label}</span>
      {radio && checked ? (
        <span className="studio-menu__check">
          <Icon name="check" />
        </span>
      ) : (
        hint && <span className="studio-menu__hint">{hint}</span>
      )}
    </button>
  );
}
