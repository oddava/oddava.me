import { useEffect, useRef, useState } from 'preact/hooks';

export interface StudioSelectOption {
  value: string;
  label: string;
  /** Indent level, for option lists shaped like a folder tree. */
  depth?: number;
}

interface Props {
  value: string;
  options: StudioSelectOption[];
  /** Accessible name for the control and its list. */
  label: string;
  /** Shown when `value` matches no option — an unchosen action menu. */
  placeholder?: string;
  disabled?: boolean;
  /** Which edge the menu lines up with. */
  align?: 'start' | 'end';
  /** Open upward when the control sits at the bottom of its panel. */
  placement?: 'down' | 'up';
  className?: string;
  onChange: (value: string) => void;
}

/**
 * A dropdown that obeys the admin theme. A native `<select>` paints its popup
 * with OS chrome — white on white in a dark panel — and nothing in CSS reaches
 * inside it, so the list is rebuilt here as a listbox.
 */
export default function StudioSelect({
  value,
  options,
  label,
  placeholder,
  disabled = false,
  align = 'end',
  placement = 'down',
  className,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Land on the current choice so the arrow keys start from the right place.
  useEffect(() => {
    if (!open) return;
    const items =
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const index = options.findIndex((option) => option.value === value);
    items?.[Math.max(0, index)]?.focus();
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function focusOption(index: number) {
    const items =
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!items?.length) return;
    items[Math.min(Math.max(index, 0), items.length - 1)]?.focus();
  }

  return (
    <div
      className={`studio-select ${open ? 'is-open' : ''} ${className ?? ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="studio-select__trigger"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="studio-select__value">
          {selected?.label ?? placeholder ?? ''}
        </span>
        <svg
          className="studio-select__caret"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className={`studio-select__menu ${align === 'start' ? 'is-start' : ''} ${
            placement === 'up' ? 'is-up' : ''
          }`}
          role="listbox"
          aria-label={label}
          ref={listRef}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              style={
                option.depth
                  ? { paddingLeft: `${9 + option.depth * 11}px` }
                  : undefined
              }
              onClick={() => {
                close();
                onChange(option.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  focusOption(index + 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusOption(index - 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  focusOption(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  focusOption(options.length - 1);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                } else if (event.key === 'Tab') {
                  close(false);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
