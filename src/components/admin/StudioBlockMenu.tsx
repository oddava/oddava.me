import StudioContextMenu from './StudioContextMenu';
import type { MenuPosition } from './useStudioMenu';
import { blockLabel, type StudioBlock, type TurnTarget } from './studioBlocks';
import type { RefObject } from 'preact';

/**
 * What a block can be turned into. The Markdown beside each one is the same
 * glyph the slash menu shows, so the two menus teach the same shorthand.
 */
const TURN_INTO: { label: string; hint: string; target: TurnTarget }[] = [
  { label: 'Text', hint: 'Aa', target: { type: 'paragraph' } },
  { label: 'Heading 1', hint: '#', target: { type: 'heading', depth: 1 } },
  { label: 'Heading 2', hint: '##', target: { type: 'heading', depth: 2 } },
  { label: 'Heading 3', hint: '###', target: { type: 'heading', depth: 3 } },
  { label: 'Bulleted list', hint: '-', target: { type: 'list' } },
  { label: 'To-do list', hint: '[ ]', target: { type: 'task' } },
  { label: 'Quote', hint: '>', target: { type: 'quote' } },
  { label: 'Code', hint: '```', target: { type: 'code' } },
];

interface Props {
  /** The block the menu was opened on, or null when it is shut. */
  block: StudioBlock | null;
  menuRef: RefObject<HTMLDivElement>;
  position: MenuPosition;
  onClose: () => void;
  onTurnInto: (target: TurnTarget) => void;
  columnLayout?: string;
  onColumnLayout?: (layout: string) => void;
  onStack?: () => void;
  onAddColumn?: () => void;
  onColumns?: (count: number) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

/**
 * Everything you can do to one block, in one menu.
 *
 * Rendered once for the whole surface rather than once per block: the menu is
 * a portal to `document.body` either way, and a note with three hundred blocks
 * does not need three hundred of them standing by. Every item carries the
 * shortcut that does the same thing, so the menu is a way to stop needing it.
 */
export default function StudioBlockMenu({
  block,
  menuRef,
  position,
  onClose,
  onTurnInto,
  onMove,
  onColumns,
  columnLayout,
  onColumnLayout,
  onStack,
  onAddColumn,
  onDuplicate,
  onCopy,
  onDelete,
}: Props) {
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <StudioContextMenu
      open={block !== null}
      label={
        block
          ? `Actions for this ${blockLabel(block).toLowerCase()}`
          : 'Block actions'
      }
      menuRef={menuRef}
      position={position}
    >
      <details className="studio-menu-turn">
        <summary>Turn into</summary>
        {TURN_INTO.map((option) => (
          <button
            type="button"
            key={option.label}
            onClick={run(() => onTurnInto(option.target))}
          >
            {option.label}
            <span className="studio-menu__hint">{option.hint}</span>
          </button>
        ))}
      </details>
      <span className="studio-menu__divider" role="separator" />
      <button type="button" onClick={run(() => onMove(-1))}>
        Move up
        <span className="studio-menu__hint">⌥↑</span>
      </button>
      <button type="button" onClick={run(() => onMove(1))}>
        Move down
        <span className="studio-menu__hint">⌥↓</span>
      </button>
      {onColumns && (
        <>
          <button type="button" onClick={run(() => onColumns(2))}>
            2 columns
          </button>
          <button type="button" onClick={run(() => onColumns(3))}>
            3 columns
          </button>
        </>
      )}
      {onColumnLayout && (
        <>
          <span className="studio-menu__divider" role="separator" />
          {[
            ['equal', 'Equal widths'],
            ['left', 'Wider left'],
            ['right', 'Wider right'],
          ].map(([layout, label]) => (
            <button
              type="button"
              aria-pressed={columnLayout === layout}
              onClick={run(() => onColumnLayout(layout!))}
            >
              {label}
            </button>
          ))}
        </>
      )}
      {onAddColumn && (
        <button type="button" onClick={run(onAddColumn)}>
          Add column
        </button>
      )}
      {onStack && (
        <button type="button" onClick={run(onStack)}>
          Stack
        </button>
      )}
      <button type="button" onClick={run(onDuplicate)}>
        Duplicate
        <span className="studio-menu__hint">⌘⇧D</span>
      </button>
      <button type="button" onClick={run(onCopy)}>
        Copy as Markdown
      </button>
      <button type="button" className="is-danger" onClick={run(onDelete)}>
        Delete
        <span className="studio-menu__hint">⌘⇧⌫</span>
      </button>
    </StudioContextMenu>
  );
}
