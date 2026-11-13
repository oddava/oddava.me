import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import type { SlashCommand, SlashGroup } from './studioBlocks';
import type { Point } from './studioRichGeometry';
import { Icon } from './studioIcons';
import { useStudioCaretFloat } from './useStudioCaretFloat';

interface Props {
  open: boolean;
  items: SlashCommand[];
  /** Show the group headings. Off while a query is narrowing the list. */
  grouped: boolean;
  activeIndex: number;
  position: Point | null;
  /**
   * Phone layout: the menu is a panel above the keyboard, part of the page's
   * layout, rather than a popover at the caret that the keyboard would crop.
   */
  docked?: boolean;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}

/** The textarea points `aria-controls` here, so both names live in one place. */
export const SLASH_MENU_ID = 'studio-slashmenu';

export function slashOptionId(index: number): string {
  return `studio-slash-option-${index}`;
}

function groupId(group: SlashGroup) {
  return `studio-slash-group-${group.toLowerCase()}`;
}

/** The row's tile: a block's icon, or its name set in type ("H2"). */
export function SlashGlyph({ item }: { item: SlashCommand }) {
  return (
    <span className="studio-slashmenu__glyph" aria-hidden="true">
      {'icon' in item.icon ? (
        <Icon name={item.icon.icon} />
      ) : (
        <span className="studio-slashmenu__glyph-text">{item.icon.text}</span>
      )}
    </span>
  );
}

/** The `/` menu: every block the editor can make, without leaving the keyboard. */
export default function StudioSlashMenu({
  open,
  items,
  grouped,
  activeIndex,
  position,
  docked = false,
  onHover,
  onChoose,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useStudioCaretFloat(listRef, open ? position : null, !docked);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open || !position || items.length === 0) return null;

  const row = (item: SlashCommand, index: number) => (
    <div
      key={item.id}
      id={slashOptionId(index)}
      data-index={index}
      role="option"
      aria-selected={index === activeIndex}
      aria-label={item.title}
      aria-description={item.description}
      className={`studio-slashmenu__row ${index === activeIndex ? 'is-active' : ''}`}
      // Mousedown is cancelled so focus stays in the block (a blur would
      // close the menu); the choice is the click, which is also all that a
      // screen reader's double-tap sends.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(index)}
      onMouseMove={() => {
        if (index !== activeIndex) onHover(index);
      }}
    >
      <SlashGlyph item={item} />
      <span className="studio-slashmenu__text">
        <span className="studio-slashmenu__title">{item.title}</span>
        <span className="studio-slashmenu__desc">{item.description}</span>
      </span>
      {/* The shorthand that makes the same block, like a key hint. */}
      {item.hint && (
        <kbd className="studio-slashmenu__hint" aria-hidden="true">
          {item.hint}
        </kbd>
      )}
    </div>
  );

  // Rows keep their place in the flat list, which is what the arrow keys and
  // aria-activedescendant count; groups only wrap runs of them.
  const runs: { group: SlashGroup; rows: [SlashCommand, number][] }[] = [];
  items.forEach((item, index) => {
    const last = runs.at(-1);
    if (grouped && last?.group === item.group) last.rows.push([item, index]);
    else if (grouped) runs.push({ group: item.group, rows: [[item, index]] });
    else if (last) last.rows.push([item, index]);
    else runs.push({ group: item.group, rows: [[item, index]] });
  });

  const menu = (
    <div
      ref={listRef}
      id={SLASH_MENU_ID}
      className={`studio-slashmenu ${docked ? 'is-docked' : ''}`}
      role="listbox"
      aria-label="Insert a block"
      style={
        docked
          ? undefined
          : { top: `${position.top}px`, left: `${position.left}px` }
      }
    >
      {grouped
        ? runs.map((run) => (
            <div
              key={run.group}
              role="group"
              aria-labelledby={groupId(run.group)}
              className="studio-slashmenu__section"
            >
              <p className="studio-slashmenu__group" id={groupId(run.group)}>
                {run.group}
              </p>
              {run.rows.map(([item, index]) => row(item, index))}
            </div>
          ))
        : items.map(row)}
    </div>
  );
  return docked ? menu : createPortal(menu, document.body);
}
