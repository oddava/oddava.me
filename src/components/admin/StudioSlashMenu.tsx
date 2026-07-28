import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import type { SlashCommand } from './studioBlocks';

interface Props {
  open: boolean;
  items: SlashCommand[];
  /** Show the group headings. Off while a query is narrowing the list. */
  grouped: boolean;
  activeIndex: number;
  position: { top: number; left: number } | null;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}

/** The textarea points `aria-controls` here, so both names live in one place. */
export const SLASH_MENU_ID = 'studio-slashmenu';

export function slashOptionId(index: number): string {
  return `studio-slash-option-${index}`;
}

/** The `/` menu: every block the editor can make, without leaving the keyboard. */
export default function StudioSlashMenu({
  open,
  items,
  grouped,
  activeIndex,
  position,
  onHover,
  onChoose,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open || !position || items.length === 0) return null;

  return createPortal(
    <div
      ref={listRef}
      id={SLASH_MENU_ID}
      className="studio-slashmenu"
      role="listbox"
      aria-label="Insert a block"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      {items.flatMap((item, index) => [
        // Presentational: a heading inside a listbox is not an option, and
        // announcing it as one would make the list a row longer than it is.
        ...(grouped && item.group !== items[index - 1]?.group
          ? [
              <p
                className="studio-slashmenu__group"
                role="presentation"
                key={`group-${item.group}`}
              >
                {item.group}
              </p>,
            ]
          : []),
        <button
          type="button"
          key={item.id}
          id={slashOptionId(index)}
          data-index={index}
          role="option"
          aria-selected={index === activeIndex}
          className={`studio-slashmenu__row ${index === activeIndex ? 'is-active' : ''}`}
          // Choosing on mousedown keeps focus in the block: a blur would close
          // the menu before the click landed.
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(index);
          }}
          onMouseMove={() => onHover(index)}
        >
          {/* The Markdown the row produces, shown as its icon — the glyph
                teaches the shorthand that makes the menu unnecessary. */}
          <span className="studio-slashmenu__glyph" aria-hidden="true">
            {item.hint}
          </span>
          <span className="studio-slashmenu__title">{item.title}</span>
        </button>,
      ])}
    </div>,
    document.body,
  );
}
