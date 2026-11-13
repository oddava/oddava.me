import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { altShortcut, shortcut } from './studioHelpers';
import { Icon } from './studioIcons';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Row = [label: string, keys: string];

/**
 * Every key Studio answers to, on one sheet. Menus and tooltips teach the
 * shortcuts one at a time, next to their commands; this is the place to see
 * them all at once — and to find the Markdown that makes each block.
 */
function sections(): { title: string; rows: Row[] }[] {
  return [
    {
      title: 'General',
      rows: [
        ['Search notes and commands', shortcut('P')],
        ['Show or hide the sidebar', shortcut('\\')],
        ['Save now', shortcut('S')],
        ['Back / forward', `${altShortcut('←')} / ${altShortcut('→')}`],
        ['Keyboard shortcuts', shortcut('/')],
      ],
    },
    {
      title: 'Text',
      rows: [
        ['Bold', shortcut('B')],
        ['Italic', shortcut('I')],
        ['Strikethrough', shortcut('X', true)],
        ['Inline code', shortcut('C', true)],
        ['Link', shortcut('K')],
        ['Link to a note', '[['],
        ['Undo / redo', `${shortcut('Z')} / ${shortcut('Z', true)}`],
        ['Formatting bar', altShortcut('F10')],
      ],
    },
    {
      title: 'Blocks',
      rows: [
        ['Insert a block', '/'],
        ['Block actions', 'Shift+F10'],
        ['Move block', `${altShortcut('↑')} / ${altShortcut('↓')}`],
        ['Duplicate block', shortcut('D', true)],
        ['Delete selected block', 'Del'],
        ['Delete block at the caret', shortcut('Backspace', true)],
        ['Indent / outdent', 'Tab / Shift+Tab'],
      ],
    },
    {
      title: 'Markdown',
      rows: [
        ['Heading 1, 2, 3', '#  ##  ###'],
        ['Bulleted list', '-'],
        ['Numbered list', '1.'],
        ['To-do list', '[ ]'],
        ['Quote', '>'],
        ['Code block', '```'],
        ['Divider', '---'],
      ],
    },
  ];
}

export default function StudioShortcuts({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="studio-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="studio-palette studio-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-shortcuts-title"
        // Focus stays in the dialog, between its close button and its
        // list, which takes focus so the arrow keys can scroll it.
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          event.preventDefault();
          const body = bodyRef.current;
          (document.activeElement === body ? closeRef.current : body)?.focus();
        }}
      >
        <header className="studio-shortcuts__head">
          <h2 id="studio-shortcuts-title">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="studio-icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div
          className="studio-shortcuts__body"
          ref={bodyRef}
          tabIndex={0}
          role="region"
          aria-label="Shortcut list"
        >
          {sections().map((section) => (
            <section key={section.title} className="studio-shortcuts__section">
              <h3>{section.title}</h3>
              <dl>
                {section.rows.map(([label, keys]) => (
                  <div key={label} className="studio-shortcuts__row">
                    <dt>{label}</dt>
                    <dd>
                      {keys.split(' / ').map((combo, index) => (
                        <span key={combo}>
                          {index > 0 && (
                            <span className="studio-shortcuts__or">/</span>
                          )}
                          <kbd>{combo}</kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
