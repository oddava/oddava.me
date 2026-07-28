import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import type { EditorCommands } from './studioEditorCommands';

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
  commands: EditorCommands;
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Macintosh|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const icon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Action({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      className="studio-inline-tool"
      aria-label={label}
      title={hint ? `${label} · ${hint}` : label}
      // Keep the selection alive while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The formatting bar, only while there is something to format. It replaces the
 * permanent toolbar that used to sit above every note: the same commands, but
 * next to the words they act on and gone the moment the selection is.
 */
export default function StudioInlineToolbar({
  position,
  docked = false,
  commands,
}: Props) {
  if (!position && !docked) return null;

  return createPortal(
    <div
      className={`studio-inline-toolbar ${docked ? 'is-docked' : ''}`}
      role="toolbar"
      aria-label="Formatting"
      style={
        docked || !position
          ? undefined
          : { top: `${position.top}px`, left: `${position.left}px` }
      }
    >
      <Action label="Bold" hint={`${mod}B`} onClick={commands.bold}>
        <span className="studio-tool-glyph studio-tool-glyph--bold">B</span>
      </Action>
      <Action label="Italic" hint={`${mod}I`} onClick={commands.italic}>
        <span className="studio-tool-glyph studio-tool-glyph--italic">I</span>
      </Action>
      <Action label="Strikethrough" hint={`${mod}⇧X`} onClick={commands.strike}>
        <span className="studio-tool-glyph studio-tool-glyph--strike">S</span>
      </Action>
      <Action
        label="Inline code"
        hint={`${mod}⇧C`}
        onClick={commands.inlineCode}
      >
        <svg viewBox="0 0 20 20" {...icon}>
          <path d="M7.5 6.5 4 10l3.5 3.5M12.5 6.5 16 10l-3.5 3.5" />
        </svg>
      </Action>
      <span className="studio-inline-toolbar__divider" aria-hidden="true" />
      <Action label="Link" hint={`${mod}K`} onClick={commands.link}>
        <svg viewBox="0 0 20 20" {...icon}>
          <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1" />
          <path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1" />
        </svg>
      </Action>
      <Action
        label="Link to a note"
        hint="[["
        onClick={() => commands.insertInline('[[')}
      >
        <span className="studio-tool-glyph">[[</span>
      </Action>
    </div>,
    document.body,
  );
}
