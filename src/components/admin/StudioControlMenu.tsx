import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** Native buttons and switches retain normal Tab behavior inside the panel. */
export default function StudioControlMenu({
  label,
  children,
  settings = false,
}: {
  label: string;
  children: ComponentChildren;
  settings?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="studio-control-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onFocusOut={(event) => {
        if (
          event.relatedTarget &&
          !root.current?.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="studio-control-menu__trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={label}
      >
        {settings ? (
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="studio-control-menu__settings"
          >
            <path d="M3 6h3m4 0h7M3 14h7m4 0h3" />
            <circle cx="8" cy="6" r="2" />
            <circle cx="12" cy="14" r="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="4" cy="10" r="1.25" />
            <circle cx="10" cy="10" r="1.25" />
            <circle cx="16" cy="10" r="1.25" />
          </svg>
        )}
      </button>
      {open && (
        <div
          className="studio-control-menu__panel"
          role="region"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function StudioWorkspaceLinks() {
  return (
    <div className="studio-workspace-links">
      <a href="/admin">Admin</a>
      <a href="/" target="_blank" rel="noreferrer">
        Open site <span aria-hidden="true">↗</span>
      </a>
      <form method="post" action="/api/admin/logout">
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
