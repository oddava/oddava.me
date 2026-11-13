import StudioContextMenu, { MenuItem } from './StudioContextMenu';
import type { MenuPosition } from './useStudioMenu';
import { blockLabel, type StudioBlock, type TurnTarget } from './studioBlocks';
import type { RefObject } from 'preact';
import { Icon, type IconName } from './studioIcons';
import { altShortcut, shortcut } from './studioHelpers';

/**
 * What a block can be turned into. The Markdown beside each one is the same
 * glyph the slash menu shows, so the two menus teach the same shorthand.
 */
const TURN_INTO: {
  label: string;
  hint: string;
  icon?: IconName;
  glyph?: string;
  target: TurnTarget;
}[] = [
  { label: 'Text', hint: '', icon: 'text', target: { type: 'paragraph' } },
  ...[1, 2, 3, 4, 5, 6].map((depth) => ({
    label: `Heading ${depth}`,
    hint: '#'.repeat(depth),
    glyph: `H${depth}`,
    target: { type: 'heading' as const, depth },
  })),
  {
    label: 'Bulleted list',
    hint: '-',
    icon: 'list-bullet',
    target: { type: 'list' },
  },
  {
    label: 'Numbered list',
    hint: '1.',
    icon: 'list-ordered',
    target: { type: 'list', ordered: true },
  },
  { label: 'To-do list', hint: '[ ]', icon: 'task', target: { type: 'task' } },
  { label: 'Quote', hint: '>', icon: 'quote', target: { type: 'quote' } },
  { label: 'Code', hint: '```', icon: 'code', target: { type: 'code' } },
];

/** Whether `block` already is what `target` would turn it into. */
function isCurrent(block: StudioBlock, target: TurnTarget): boolean {
  if (block.type !== target.type) return false;
  if (block.type === 'heading') return block.depth === target.depth;
  if (block.type === 'list')
    return /^\s*\d+[.)]\s/.test(block.raw) === Boolean(target.ordered);
  return true;
}

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
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        document.querySelector<HTMLElement>('.studio-rich-content')?.focus();
    });
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
      {/* Opens in place rather than as a flyout, so a narrow screen never
          has to fit two menus side by side. ArrowRight opens it and
          ArrowLeft closes it, like a submenu (see useStudioMenu). */}
      <details
        className="studio-menu-turn"
        onToggle={(event) => {
          const open = event.currentTarget.open;
          event.currentTarget
            .querySelector('summary')
            ?.setAttribute('aria-expanded', String(open));
        }}
      >
        <summary role="menuitem" aria-expanded="false">
          <Icon name="turn-into" />
          <span className="studio-menu__label">Turn into</span>
          <Icon name="chevron-right" />
        </summary>
        <div role="group" aria-label="Turn into">
          {TURN_INTO.map((option) => {
            const current = block ? isCurrent(block, option.target) : false;
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className="studio-menu__item"
                key={option.label}
                onClick={run(() => {
                  if (!current) onTurnInto(option.target);
                })}
              >
                {option.icon ? (
                  <Icon name={option.icon} />
                ) : (
                  <span className="studio-menu__glyph-text" aria-hidden="true">
                    {option.glyph}
                  </span>
                )}
                <span className="studio-menu__label">{option.label}</span>
                {current ? (
                  <span className="studio-menu__check">
                    <Icon name="check" />
                  </span>
                ) : (
                  option.hint && (
                    <span className="studio-menu__hint">{option.hint}</span>
                  )
                )}
              </button>
            );
          })}
        </div>
      </details>
      <span className="studio-menu__divider" role="separator" />
      <MenuItem
        icon="arrow-up"
        label="Move up"
        hint={altShortcut('↑')}
        onClick={run(() => onMove(-1))}
      />
      <MenuItem
        icon="arrow-down"
        label="Move down"
        hint={altShortcut('↓')}
        onClick={run(() => onMove(1))}
      />
      {onColumns && (
        <>
          <MenuItem
            icon="columns"
            label="2 columns"
            onClick={run(() => onColumns(2))}
          />
          <MenuItem
            icon="columns-3"
            label="3 columns"
            onClick={run(() => onColumns(3))}
          />
        </>
      )}
      {onColumnLayout && (
        <>
          <span className="studio-menu__divider" role="separator" />
          {(
            [
              ['equal', 'Equal widths', 'columns'],
              ['left', 'Wider left', 'column-wide-left'],
              ['right', 'Wider right', 'column-wide-right'],
            ] as const
          ).map(([layout, label, icon]) => (
            <MenuItem
              key={layout}
              icon={icon}
              label={label}
              checked={columnLayout === layout}
              onClick={run(() => onColumnLayout(layout!))}
            />
          ))}
        </>
      )}
      {onAddColumn && (
        <MenuItem icon="plus" label="Add column" onClick={run(onAddColumn)} />
      )}
      {onStack && (
        <MenuItem icon="stack" label="Stack" onClick={run(onStack)} />
      )}
      <span className="studio-menu__divider" role="separator" />
      <MenuItem
        icon="copy"
        label="Duplicate"
        hint={shortcut('D', true)}
        onClick={run(onDuplicate)}
      />
      <MenuItem icon="code" label="Copy as Markdown" onClick={run(onCopy)} />
      <span className="studio-menu__divider" role="separator" />
      <MenuItem
        icon="trash"
        label="Delete"
        danger
        hint="Del"
        onClick={run(onDelete)}
      />
    </StudioContextMenu>
  );
}
