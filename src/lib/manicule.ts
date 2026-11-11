/**
 * One manicule per list, gliding to the row under the pointer or the focus.
 *
 * Markup: a `[data-manicule-list]` container (positioned), its rows marked
 * `[data-manicule-row]`, and one `<Manicule glide />` inside it. At rest the
 * hand points at the row that is current (`aria-current` on the row or a link
 * in it) or hides; it follows hover and keyboard focus, and comes back when
 * they leave. The movement itself is a CSS transition on `--hand-y`, so a new
 * target interrupts the old one mid-flight. Lists that arrive later (server
 * islands, search results) are picked up by calling `mountManiculeLists`
 * again; a list is only ever wired once.
 */

const MOUNTED = new WeakSet<HTMLElement>();

function currentRow(list: HTMLElement): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-manicule-row]')) {
    if (row.matches('[aria-current]') || row.querySelector('[aria-current]')) {
      return row;
    }
  }
  return null;
}

function mountList(list: HTMLElement) {
  if (MOUNTED.has(list)) return;
  const hand = list.querySelector<SVGElement>('[data-manicule-hand]');
  if (!hand) return;
  MOUNTED.add(list);

  let shown: HTMLElement | null = null;

  const place = (row: HTMLElement | null) => {
    if (row === shown) return;
    if (!row) {
      hand.removeAttribute('data-shown');
      shown = null;
      return;
    }
    const listBox = list.getBoundingClientRect();
    const rowBox = (
      row.querySelector<HTMLElement>('[data-manicule-anchor]') ?? row
    ).getBoundingClientRect();
    const y = rowBox.top - listBox.top + rowBox.height / 2;
    const arriving = !hand.hasAttribute('data-shown');
    // A hand that was hidden appears in place; one already showing travels,
    // tipped forward until it lands.
    hand.toggleAttribute('data-arriving', arriving);
    hand.toggleAttribute('data-moving', !arriving);
    hand.style.setProperty('--hand-y', `${y}px`);
    hand.setAttribute('data-shown', '');
    shown = row;
  };

  hand.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'transform') hand.removeAttribute('data-moving');
  });

  const rowOf = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-manicule-row]')
      : null;

  const rest = () => place(currentRow(list));

  list.addEventListener('pointerover', (event) => {
    if ((event as PointerEvent).pointerType === 'touch') return;
    const row = rowOf(event.target);
    if (row && list.contains(row)) place(row);
  });
  list.addEventListener('pointerleave', () => {
    if (!list.contains(document.activeElement)) rest();
  });
  list.addEventListener('focusin', (event) => {
    const row = rowOf(event.target);
    if (row) place(row);
  });
  list.addEventListener('focusout', (event) => {
    if (!list.contains(event.relatedTarget as Node | null)) rest();
  });

  // The current row can change under us (the contents of a note follow the
  // reading position), and the list can reflow.
  new MutationObserver(() => {
    if (!list.matches(':hover') && !list.contains(document.activeElement)) {
      shown = null;
      rest();
    }
  }).observe(list, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current'],
  });
  new ResizeObserver(() => {
    const row = shown;
    shown = null;
    if (row && list.contains(row)) place(row);
    else rest();
  }).observe(list);

  rest();
}

export function mountManiculeLists(root: ParentNode = document) {
  for (const list of root.querySelectorAll<HTMLElement>(
    '[data-manicule-list]',
  )) {
    mountList(list);
  }
}
