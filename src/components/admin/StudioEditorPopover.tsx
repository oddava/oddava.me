import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

function textAnchor() {
  const selected = document.querySelector(
    '.studio-rich-content .ProseMirror-selectednode',
  );
  if (selected) return () => selected.getBoundingClientRect();
  const selection = window.getSelection();
  if (
    selection?.rangeCount &&
    selection.anchorNode?.parentElement?.closest('.studio-rich-content')
  ) {
    const range = selection.getRangeAt(0).cloneRange();
    const element =
      selection.anchorNode.nodeType === 1
        ? (selection.anchorNode as Element)
        : selection.anchorNode.parentElement;
    return () => {
      const rect = range.getBoundingClientRect();
      // A caret in an empty paragraph has no range box in some browsers.
      return rect.height ? rect : element?.getBoundingClientRect();
    };
  }
  const source = document.querySelector('.studio-textarea');
  const editor = document.querySelector('.studio-rich-content');
  return () => (source ?? editor)?.getBoundingClientRect();
}

/** Shared, text-anchored editing dialog. No backdrop or page-sized overlay. */
export default function StudioEditorPopover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [anchor] = useState(textAnchor);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  useLayoutEffect(() => {
    const panel = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const place = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      panel.style.maxHeight = `${height - 24}px`;
      panel.style.maxWidth = `${width - 24}px`;
      const rect = anchor();
      const size = panel.getBoundingClientRect();
      const below = (rect?.bottom ?? y + 60) + 8;
      const above = (rect?.top ?? y + 60) - size.height - 8;
      const top =
        below + size.height <= y + height - 12
          ? below
          : above >= y + 12
            ? above
            : y + height - size.height - 12;
      setPosition({
        top: Math.max(y + 12, top),
        left: Math.max(
          x + 12,
          Math.min(rect?.left ?? x + 12, x + width - size.width - 12),
        ),
        ready: true,
      });
    };
    place();
    const focusFrame = requestAnimationFrame(() => {
      panel
        .querySelector<HTMLElement>('input, textarea, button[type="submit"]')
        ?.focus({ preventScroll: true });
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!panel.contains(target) && !target.closest('[role="listbox"]'))
        close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
      }
    };
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
      if (
        panel.contains(document.activeElement) ||
        document.activeElement === document.body
      )
        previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      className="studio-editor-popover"
      role="dialog"
      aria-label={title}
      style={{
        top: position.top,
        left: position.left,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
          ),
        );
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (
          (event.shiftKey && index === 0) ||
          (!event.shiftKey && index === controls.length - 1)
        ) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }}
    >
      <header className="studio-editor-popover__head">
        <strong>{title}</strong>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="studio-editor-popover__body">{children}</div>
    </div>,
    document.body,
  );
}
