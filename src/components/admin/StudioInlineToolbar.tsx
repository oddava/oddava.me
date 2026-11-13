import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { EditorCommands } from './studioEditorCommands';
import type { TurnTarget } from './studioBlocks';
import { shortcut } from './studioHelpers';
import { Icon, type IconName } from './studioIcons';

interface Props {
  /** Viewport point the selection starts at, or null when nothing is selected. */
  position: { top: number; left: number } | null;
  /**
   * Phone layout: pin the bar to the bottom edge for the whole time a block is
   * open, rather than floating it at the caret. A popover next to the caret is
   * the one place a phone will not leave it — that is where the platform's own
   * selection bubble goes, and where a thumb cannot reach without covering the
   * words being formatted.
   */
  docked?: boolean;
  /**
   * Docked with the keyboard down, the bar is the screen's bottom edge and
   * clears the home indicator; with it up, the keyboard is the edge.
   */
  keyboardOpen?: boolean;
  commands: EditorCommands;
  activeMarks?: ReadonlySet<string>;
  /** What the selection's block is now, named as the Turn into list names it. */
  blockType?: string;
  onTurnInto?: (target: TurnTarget) => void;
  /** Focus left the bar for somewhere other than the note. */
  onDismiss?: () => void;
}

/** The block types the bar can switch to: the common ones, as Notion's does. */
export const TOOLBAR_TURN_INTO: {
  label: string;
  icon?: IconName;
  glyph?: string;
  target: TurnTarget;
}[] = [
  { label: 'Text', icon: 'text', target: { type: 'paragraph' } },
  { label: 'Heading 1', glyph: 'H1', target: { type: 'heading', depth: 1 } },
  { label: 'Heading 2', glyph: 'H2', target: { type: 'heading', depth: 2 } },
  { label: 'Heading 3', glyph: 'H3', target: { type: 'heading', depth: 3 } },
  { label: 'Bulleted list', icon: 'list-bullet', target: { type: 'list' } },
  {
    label: 'Numbered list',
    icon: 'list-ordered',
    target: { type: 'list', ordered: true },
  },
  { label: 'To-do list', icon: 'task', target: { type: 'task' } },
  { label: 'Quote', icon: 'quote', target: { type: 'quote' } },
  { label: 'Code', icon: 'code', target: { type: 'code' } },
];

function Action({
  label,
  hint,
  onClick,
  active,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  active?: boolean;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      className="studio-inline-tool"
      aria-label={label}
      aria-pressed={active}
      title={hint ? `${label} (${hint})` : label}
      tabIndex={-1}
      // Keep the selection alive while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Focus the floating Formatting bar from the editor (Alt+F10). */
export function focusFormattingToolbar(): boolean {
  const first = document.querySelector<HTMLElement>(
    '.studio-inline-toolbar[aria-label="Formatting"] button',
  );
  first?.focus();
  return Boolean(first);
}

/**
 * The formatting bar, only while there is something to format. It replaces the
 * permanent toolbar that used to sit above every note: the same commands, but
 * next to the words they act on and gone the moment the selection is.
 *
 * From the keyboard: Alt+F10 in the note moves focus here, arrows move along
 * it, Escape goes back to the words — the toolbar pattern, with one stop.
 */
export default function StudioInlineToolbar({
  position,
  docked = false,
  keyboardOpen = false,
  commands,
  activeMarks,
  blockType,
  onTurnInto,
  onDismiss,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [turnOpen, setTurnOpen] = useState(false);
  const visible = Boolean(position) || docked;

  useEffect(() => {
    if (!visible) setTurnOpen(false);
  }, [visible]);

  // Turn into opens below the bar, or above it where the window has no room
  // below — every choice on screen, so focus never lands out of sight.
  const [turnUp, setTurnUp] = useState(false);
  useLayoutEffect(() => {
    if (!turnOpen) {
      setTurnUp(false);
      return;
    }
    const bar = barRef.current?.getBoundingClientRect();
    const menu = barRef.current
      ?.querySelector('.studio-turnmenu')
      ?.getBoundingClientRect();
    if (!bar || !menu) return;
    const viewport = window.visualViewport;
    const bottom =
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    setTurnUp(
      bar.bottom + 6 + menu.height + 8 > bottom && bar.top > menu.height + 14,
    );
  }, [turnOpen]);

  if (!visible) return null;

  function backToText() {
    setTurnOpen(false);
    (
      document.querySelector('.studio-rich-content') as HTMLElement | null
    )?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    const items = Array.from(
      barRef.current?.querySelectorAll<HTMLElement>(
        turnOpen ? '.studio-turnmenu button' : ':scope > button',
      ) ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const prev = turnOpen ? 'ArrowUp' : 'ArrowLeft';
    const next = turnOpen ? 'ArrowDown' : 'ArrowRight';
    let target: HTMLElement | undefined;
    if (event.key === next) target = items[(index + 1) % items.length];
    else if (event.key === prev)
      target = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Tab') {
      event.preventDefault();
      backToText();
      return;
    } else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items.at(-1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (turnOpen) {
        setTurnOpen(false);
        barRef.current
          ?.querySelector<HTMLElement>('.studio-inline-tool--turn')
          ?.focus();
      } else backToText();
      return;
    } else return;
    event.preventDefault();
    target?.focus();
  }

  const turn = onTurnInto && blockType !== undefined && (
    <>
      <button
        type="button"
        className="studio-inline-tool studio-inline-tool--turn"
        aria-haspopup="menu"
        aria-expanded={turnOpen}
        aria-label={`Turn into, now ${blockType}`}
        title="Turn into"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setTurnOpen((open) => !open);
          // From the keyboard, land on the current type.
          requestAnimationFrame(() =>
            barRef.current
              ?.querySelector<HTMLElement>(
                '.studio-turnmenu [aria-checked="true"], .studio-turnmenu button',
              )
              ?.focus({ preventScroll: true }),
          );
        }}
      >
        <span>{blockType}</span>
        <Icon name="chevron-down" />
      </button>
      <span className="studio-inline-toolbar__divider" aria-hidden="true" />
      {turnOpen && (
        <div
          className={`studio-menu studio-turnmenu ${turnUp ? 'is-up' : ''}`}
          role="menu"
          aria-label="Turn into"
        >
          {TOOLBAR_TURN_INTO.map((option) => {
            const current = option.label === blockType;
            return (
              <button
                type="button"
                key={option.label}
                role="menuitemradio"
                aria-checked={current}
                className="studio-menu__item"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setTurnOpen(false);
                  onTurnInto(option.target);
                }}
              >
                {option.icon ? (
                  <Icon name={option.icon} />
                ) : (
                  <span className="studio-menu__glyph-text" aria-hidden="true">
                    {option.glyph}
                  </span>
                )}
                <span className="studio-menu__label">{option.label}</span>
                {current && (
                  <span className="studio-menu__check">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const toolbar = (
    <div
      ref={barRef}
      className={`studio-inline-toolbar ${docked ? 'is-docked' : ''} ${
        docked && !keyboardOpen ? 'is-bottom-edge' : ''
      }`}
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={onKeyDown}
      onFocusOut={(event) => {
        const next = event.relatedTarget as Element | null;
        if (next && barRef.current?.contains(next)) return;
        // The window losing focus (another app, another tab) is not the
        // writer leaving the bar; it is still there when they come back.
        if (!next && !document.hasFocus()) return;
        setTurnOpen(false);
        // Leaving for the page: the editor's own blur handling decides.
        if (next?.closest?.('.studio-rich-content')) return;
        onDismiss?.();
      }}
      style={
        docked || !position
          ? undefined
          : { top: `${position.top}px`, left: `${position.left}px` }
      }
    >
      {!docked && turn}
      <Action
        label="Bold"
        active={activeMarks?.has('bold')}
        hint={shortcut('B')}
        onClick={commands.bold}
      >
        <span className="studio-tool-glyph studio-tool-glyph--bold">B</span>
      </Action>
      <Action
        label="Italic"
        active={activeMarks?.has('italic')}
        hint={shortcut('I')}
        onClick={commands.italic}
      >
        <span className="studio-tool-glyph studio-tool-glyph--italic">I</span>
      </Action>
      <Action
        label="Strikethrough"
        active={activeMarks?.has('strike')}
        hint={shortcut('X', true)}
        onClick={commands.strike}
      >
        <span className="studio-tool-glyph studio-tool-glyph--strike">S</span>
      </Action>
      <Action
        label="Inline code"
        active={activeMarks?.has('code')}
        hint={shortcut('C', true)}
        onClick={commands.inlineCode}
      >
        <Icon name="code" />
      </Action>
      <span className="studio-inline-toolbar__divider" aria-hidden="true" />
      <Action
        label="Link"
        active={activeMarks?.has('link')}
        hint={shortcut('K')}
        onClick={commands.link}
      >
        <Icon name="link" />
      </Action>
      <Action
        label="Link to a note"
        hint="[["
        onClick={() => commands.insertInline('[[')}
      >
        <Icon name="note-link" />
      </Action>
    </div>
  );
  return docked ? toolbar : createPortal(toolbar, document.body);
}
