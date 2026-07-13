import type { ComponentChildren } from 'preact';
import type { EditorCommands } from './studioEditorCommands';

interface StudioToolbarProps {
  commands: EditorCommands;
  onInsertImage: () => void;
  disabled?: boolean;
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Macintosh|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

function ToolButton({
  label,
  hint,
  onClick,
  disabled,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={`studio-tool ${wide ? 'studio-tool--wide' : ''}`}
      aria-label={label}
      title={hint ? `${label} · ${hint}` : label}
      disabled={disabled}
      // Keep the editor selection while clicking a toolbar button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="studio-tool-divider" aria-hidden="true" />;
}

const icon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export default function StudioToolbar({
  commands,
  onInsertImage,
  disabled = false,
}: StudioToolbarProps) {
  return (
    <div className="studio-toolbar" role="toolbar" aria-label="Formatting">
      <div className="studio-toolbar__group">
        <ToolButton
          label="Bold"
          hint={`${mod}B`}
          disabled={disabled}
          onClick={commands.bold}
        >
          <span className="studio-tool-glyph studio-tool-glyph--bold">B</span>
        </ToolButton>
        <ToolButton
          label="Italic"
          hint={`${mod}I`}
          disabled={disabled}
          onClick={commands.italic}
        >
          <span className="studio-tool-glyph studio-tool-glyph--italic">I</span>
        </ToolButton>
        <ToolButton
          label="Strikethrough"
          disabled={disabled}
          onClick={commands.strike}
        >
          <span className="studio-tool-glyph studio-tool-glyph--strike">S</span>
        </ToolButton>
        <ToolButton
          label="Inline code"
          disabled={disabled}
          onClick={commands.inlineCode}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M7.5 6.5 4 10l3.5 3.5M12.5 6.5 16 10l-3.5 3.5" />
          </svg>
        </ToolButton>
      </div>

      <Divider />

      <div className="studio-toolbar__group">
        <ToolButton
          label="Heading 1"
          disabled={disabled}
          onClick={() => commands.heading(1)}
        >
          <span className="studio-tool-glyph studio-tool-glyph--h">H1</span>
        </ToolButton>
        <ToolButton
          label="Heading 2"
          disabled={disabled}
          onClick={() => commands.heading(2)}
        >
          <span className="studio-tool-glyph studio-tool-glyph--h">H2</span>
        </ToolButton>
        <ToolButton
          label="Heading 3"
          disabled={disabled}
          onClick={() => commands.heading(3)}
        >
          <span className="studio-tool-glyph studio-tool-glyph--h">H3</span>
        </ToolButton>
      </div>

      <Divider />

      <div className="studio-toolbar__group">
        <ToolButton
          label="Bullet list"
          disabled={disabled}
          onClick={commands.bulletList}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="14" r="1" fill="currentColor" stroke="none" />
            <path d="M8 6h8M8 10h8M8 14h8" />
          </svg>
        </ToolButton>
        <ToolButton
          label="Numbered list"
          disabled={disabled}
          onClick={commands.orderedList}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M9 6h8M9 10h8M9 14h8" />
            <path d="M3 5.5 4 5v3" strokeWidth={1.3} />
            <path
              d="M3 12.5c0-.6.5-1 1-1s1 .4 1 1c0 .8-2 1.3-2 2.5h2"
              strokeWidth={1.3}
            />
          </svg>
        </ToolButton>
        <ToolButton
          label="Task list"
          disabled={disabled}
          onClick={commands.taskList}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <rect x="2.5" y="3" width="6" height="6" rx="1.5" />
            <path d="M4 6l1.2 1.2L7 5" />
            <path d="M11 6h6M11 14h6" />
            <rect x="2.5" y="11" width="6" height="6" rx="1.5" />
          </svg>
        </ToolButton>
        <ToolButton label="Quote" disabled={disabled} onClick={commands.quote}>
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M4 5.5h4v4H5.5c0 2 .5 2.5 2 3M12 5.5h4v4h-2.5c0 2 .5 2.5 2 3" />
          </svg>
        </ToolButton>
        <ToolButton
          label="Code block"
          disabled={disabled}
          onClick={commands.codeBlock}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <rect x="2.5" y="4" width="15" height="12" rx="2" />
            <path d="M8 8.5 6 10l2 1.5M12 8.5 14 10l-2 1.5" />
          </svg>
        </ToolButton>
      </div>

      <Divider />

      <div className="studio-toolbar__group">
        <ToolButton label="Link" disabled={disabled} onClick={commands.link}>
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1" />
            <path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1" />
          </svg>
        </ToolButton>
        <ToolButton label="Image" disabled={disabled} onClick={onInsertImage}>
          <svg viewBox="0 0 20 20" {...icon}>
            <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
            <circle cx="7" cy="8" r="1.4" />
            <path d="M3 14l4-3.5 3.5 3 3-2.5 3.5 3" />
          </svg>
        </ToolButton>
        <ToolButton label="Table" disabled={disabled} onClick={commands.table}>
          <svg viewBox="0 0 20 20" {...icon}>
            <rect x="2.5" y="4" width="15" height="12" rx="2" />
            <path d="M2.5 8.5h15M2.5 12.5h15M8 4v12" />
          </svg>
        </ToolButton>
        <ToolButton
          label="Divider"
          disabled={disabled}
          onClick={commands.divider}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M3 10h14" />
            <path d="M5 6.5h10M5 13.5h10" opacity={0.4} />
          </svg>
        </ToolButton>
      </div>

      <Divider />

      <div className="studio-toolbar__group">
        <ToolButton
          label="Align left"
          disabled={disabled}
          onClick={() => commands.align('left')}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M3 5h14M3 9h9M3 13h14M3 17h9" />
          </svg>
        </ToolButton>
        <ToolButton
          label="Align center"
          disabled={disabled}
          onClick={() => commands.align('center')}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9" />
          </svg>
        </ToolButton>
        <ToolButton
          label="Align right"
          disabled={disabled}
          onClick={() => commands.align('right')}
        >
          <svg viewBox="0 0 20 20" {...icon}>
            <path d="M3 5h14M8 9h9M3 13h14M8 17h9" />
          </svg>
        </ToolButton>
      </div>
    </div>
  );
}
