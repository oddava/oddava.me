import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import type { WikiSuggestion } from './useWikiLinkAutocomplete';

interface Props {
  open: boolean;
  items: WikiSuggestion[];
  activeIndex: number;
  position: { top: number; left: number } | null;
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

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={listRef}
      id={WIKI_MENU_ID}
      className="studio-wikimenu"
      role="listbox"
      aria-label="Link to a note"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
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
          // Keep focus in the textarea: choosing on mousedown avoids a blur that
          // would close the menu before the click lands.
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(index);
          }}
          onMouseMove={() => onHover(index)}
        >
          <span className="studio-wikimenu__title">
            {item.title || item.id.replaceAll('-', ' ')}
          </span>
          {item.folder && (
            <span className="studio-wikimenu__folder">
              {item.folder.replaceAll('/', ' / ')}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
