// The glyphs both file explorers draw. Shared so the phone surface and the
// desktop tree cannot end up with two different-looking folders.

export function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 2.75h6l4 4v10.5H5V2.75Z" />
      <path d="M11 2.75v4h4" />
    </svg>
  );
}

export function FolderIcon({ open = false }: { open?: boolean }) {
  return open ? (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 6.25V5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v1" />
      <path d="M3 7.75h14l-1.2 7.08a1.75 1.75 0 0 1-1.73 1.47H5.93a1.75 1.75 0 0 1-1.73-1.47L3 7.75Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v7c0 1.24-1.01 2.25-2.25 2.25H5A2.25 2.25 0 0 1 2.75 14V5.5Z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

export function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v7c0 1.24-1.01 2.25-2.25 2.25H5A2.25 2.25 0 0 1 2.75 14V5.5Z" />
      <path d="M10 8v5M7.5 10.5h5" />
    </svg>
  );
}
