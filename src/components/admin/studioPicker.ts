// A small floating list a block opens beside itself — the code block's language
// chip, a callout's kind. Plain DOM rather than a Preact island because it is
// opened from ProseMirror node views, which live outside the component tree.
//
// It is a combobox when searchable (the input owns focus, the list is driven by
// aria-activedescendant) and a bare listbox otherwise.

export interface PickerOption {
  id: string;
  label: string;
  /** Quiet text at the row's end: the Markdown that makes the same thing. */
  hint?: string;
  /** Extra words that should find the row. */
  keywords?: string;
  /** Names a colour the stylesheet gives the row's dot (`data-tone`). */
  tone?: string;
}

function rank(option: PickerOption, needle: string): number | null {
  const label = option.label.toLowerCase();
  if (option.id === needle) return 100;
  if (label.startsWith(needle)) return 80;
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 60;
  if (option.id.startsWith(needle)) return 50;
  if (label.includes(needle)) return 40;
  if (option.keywords?.toLowerCase().includes(needle)) return 20;
  return null;
}

/** The options worth showing for `query`, best match first; all when empty. */
export function filterPickerOptions(
  options: readonly PickerOption[],
  query: string,
): PickerOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options
    .map((option) => ({ option, score: rank(option, needle) }))
    .filter((row): row is { option: PickerOption; score: number } => {
      return row.score !== null;
    })
    .toSorted((a, b) => b.score - a.score)
    .map((row) => row.option);
}

export interface PickerRequest {
  anchor: HTMLElement;
  /** Names the list for assistive technology and the search field. */
  title: string;
  options: readonly PickerOption[];
  /** The option already in effect; it opens highlighted. */
  current: string | null;
  searchable?: boolean;
  /**
   * An option to offer when what was typed matches nothing exactly — the way
   * to name a language the list does not know.
   */
  custom?: (query: string) => PickerOption | null;
  onPick: (id: string) => void;
}

let closeActive: (() => void) | null = null;
let serial = 0;

/** Close whichever picker is open, if any. */
export function closePicker() {
  closeActive?.();
}

/** Opens the picker under `request.anchor` and returns a function that closes it. */
export function openPicker(request: PickerRequest): () => void {
  closePicker();
  const { anchor, searchable = false } = request;
  const id = `studio-picker-${(serial += 1)}`;

  const root = document.createElement('div');
  root.className = 'studio-picker';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', request.title);

  const list = document.createElement('ul');
  list.className = 'studio-picker__list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', request.title);

  let input: HTMLInputElement | null = null;
  if (searchable) {
    input = document.createElement('input');
    input.className = 'studio-picker__search';
    input.type = 'text';
    input.placeholder = 'Search…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', `Search ${request.title.toLowerCase()}`);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-autocomplete', 'list');
    root.append(input);
  } else {
    list.tabIndex = 0;
  }
  root.append(list);

  let shown: PickerOption[] = [];
  let active = 0;

  function visible(query: string): PickerOption[] {
    const matches = filterPickerOptions(request.options, query);
    const extra = query.trim() ? request.custom?.(query.trim()) : null;
    const taken = extra && matches.some((option) => option.id === extra.id);
    return extra && !taken ? [...matches, extra] : matches;
  }

  function highlight(next: number) {
    active = Math.max(0, Math.min(shown.length - 1, next));
    const focusTarget = input ?? list;
    list.querySelectorAll('[role="option"]').forEach((row, index) => {
      row.classList.toggle('is-active', index === active);
      if (index === active) {
        row.scrollIntoView({ block: 'nearest' });
        focusTarget.setAttribute('aria-activedescendant', row.id);
      }
    });
  }

  function render(query: string) {
    shown = visible(query);
    list.replaceChildren();
    shown.forEach((option, index) => {
      const row = document.createElement('li');
      row.id = `${id}-${index}`;
      row.className = 'studio-picker__option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.id === request.current));
      if (option.tone) row.dataset.tone = option.tone;
      const label = document.createElement('span');
      label.className = 'studio-picker__label';
      label.textContent = option.label;
      row.append(label);
      if (option.hint) {
        const hint = document.createElement('span');
        hint.className = 'studio-picker__hint';
        hint.textContent = option.hint;
        row.append(hint);
      }
      // Pressing, not clicking, so the editor behind never sees a blur first.
      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        choose(index);
      });
      row.addEventListener('pointermove', () => {
        if (active !== index) highlight(index);
      });
      list.append(row);
    });
    if (!shown.length) {
      const empty = document.createElement('li');
      empty.className = 'studio-picker__empty';
      empty.textContent = 'Nothing matches';
      list.append(empty);
    }
    const current = shown.findIndex((option) => option.id === request.current);
    highlight(query.trim() ? 0 : Math.max(0, current));
  }

  function choose(index: number) {
    const option = shown[index];
    if (!option) return;
    close(false);
    request.onPick(option.id);
  }

  function position() {
    const gap = 6;
    const margin = 8;
    const box = anchor.getBoundingClientRect();
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const below = box.bottom + gap;
    const top =
      below + height > window.innerHeight - margin &&
      box.top - gap - height > margin
        ? box.top - gap - height
        : Math.min(
            below,
            Math.max(margin, window.innerHeight - margin - height),
          );
    const left = Math.max(
      margin,
      Math.min(box.left, window.innerWidth - margin - width),
    );
    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!input) {
        event.preventDefault();
        highlight(event.key === 'Home' ? 0 : shown.length - 1);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      choose(active);
    } else if (event.key === 'Tab') {
      close(true);
    }
  }

  // Anything that moves the page out from under the anchor would leave the list
  // floating over the wrong thing.
  const away = (event: Event) => {
    if (!root.contains(event.target as Node)) close(false);
  };
  const outside = (event: PointerEvent) => {
    if (
      !root.contains(event.target as Node) &&
      !anchor.contains(event.target as Node)
    )
      close(false);
  };

  function close(restoreFocus: boolean) {
    if (closeActive !== closeThis) return;
    closeActive = null;
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('scroll', away, true);
    window.removeEventListener('resize', away);
    anchor.setAttribute('aria-expanded', 'false');
    root.remove();
    if (restoreFocus) anchor.focus();
  }
  const closeThis = () => close(false);
  closeActive = closeThis;

  root.addEventListener('keydown', onKeyDown);
  input?.addEventListener('input', () => render(input!.value));
  anchor.setAttribute('aria-expanded', 'true');
  document.body.append(root);
  render('');
  position();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', away, true);
  window.addEventListener('resize', away);
  (input ?? list).focus({ preventScroll: true });
  return closeThis;
}
