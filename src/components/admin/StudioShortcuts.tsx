import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { altShortcut, historyShortcuts, shortcut } from './studioHelpers';
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
export function shortcutSections(): { title: string; rows: Row[] }[] {
  const [back, forward] = historyShortcuts();
  return [
    {
      title: 'General',
      rows: [
        ['Search notes and commands', shortcut('P')],
        ['Show or hide the sidebar', shortcut('\\')],
        ['Save now', shortcut('S')],
        ['Find in note', shortcut('F')],
        [
          'Next / previous match',
          `Enter / Shift+Enter / F3 / Shift+F3 / ${shortcut('G')} / ${shortcut('G', true)}`,
        ],
        ['Replace', `${shortcut('F')}, then ›`],
        ['Outline', shortcut('O', true)],
        ['Focus mode', shortcut('F', true)],
        ['Page style and typewriter scroll', 'Aa'],
        ['Close what is open, one at a time', 'Esc'],
        ['Back / forward', `${back} / ${forward}`],
        ['Keyboard shortcuts', shortcut('/')],
      ],
    },
    {
      title: 'Text',
      rows: [
        ['Bold', shortcut('B')],
        ['Italic', shortcut('I')],
        ['Strikethrough', shortcut('X', true)],
        ['Inline code', `${shortcut('E')} / ${shortcut('C', true)}`],
        ['Link', shortcut('K')],
        ['Link to a note', '[['],
        ['Tag', '#tag'],
        ['Back from a footnote to its mark', `Esc / ${shortcut('Enter')}`],
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
        ['Callout', '> [!NOTE]'],
        ['Code block', '```'],
        ['Divider', '---'],
        ['Footnote', '[^1]'],
        ['Tag', '#tag'],
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
        data-studio-layer="modal"
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
          {shortcutSections().map((section) => (
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
          <p className="studio-shortcuts__note">
            Version history and Publish have no key: find them in the palette (
            {shortcut('P')}).
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
