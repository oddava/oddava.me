import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import type { Point } from './studioRichGeometry';
import { FileIcon } from './studioFileIcons';
import { useStudioCaretFloat } from './useStudioCaretFloat';
export interface WikiSuggestion {
  id: string;
  title: string;
  folder: string;
  href?: string;
  insert: string;
  icon?: string;
}

interface Props {
  open: boolean;
  items: WikiSuggestion[];
  activeIndex: number;
  position: Point | null;
  /** Phone layout: a panel above the keyboard, like the slash menu's. */
  docked?: boolean;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}

/** The textarea points `aria-controls` here, so both names live in one place. */
export const WIKI_MENU_ID = 'studio-wikimenu';

export function wikiOptionId(index: number): string {
  return `studio-wiki-option-${index}`;
}

export default function WikiLinkAutocomplete({
  open,
  items,
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

  if (!open || !position) return null;

  const menu = (
    <div
      ref={listRef}
      id={WIKI_MENU_ID}
      className={`studio-wikimenu ${docked ? 'is-docked' : ''}`}
      role="listbox"
      aria-label="Link to a note"
      style={
        docked
          ? undefined
          : { top: `${position.top}px`, left: `${position.left}px` }
      }
    >
      {items.map((item, index) => (
        <button
          type="button"
          key={`${item.folder}/${item.id}`}
          id={wikiOptionId(index)}
          data-index={index}
          role="option"
          aria-selected={index === activeIndex}
          className={`studio-wikimenu__row ${index === activeIndex ? 'is-active' : ''}`}
          tabIndex={-1}
          // Mousedown is cancelled so focus stays in the editor (a blur would
          // close the menu); the choice is the click, which is also all a
          // screen reader's double-tap sends.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(index)}
          onMouseMove={() => onHover(index)}
        >
          <span className="studio-wikimenu__icon" aria-hidden="true">
            <FileIcon icon={item.icon} />
          </span>
          <span className="studio-wikimenu__text">
            <span className="studio-wikimenu__title">
              {item.title || item.id.replaceAll('-', ' ')}
            </span>
            {item.folder && (
              <span className="studio-wikimenu__folder">
                {item.folder.replaceAll('/', ' / ')}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
  return docked ? menu : createPortal(menu, document.body);
}
