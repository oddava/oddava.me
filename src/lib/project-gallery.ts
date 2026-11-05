/**
 * The sideways gallery's behaviour, for /projects and home's strip. The track
 * scrolls natively — touch swipe, trackpad, shift+wheel, and Tab into a card
 * all work without this. On top of that: a mouse can drag it, a plain wheel
 * moves it sideways while it still has room, the arrow keys and buttons step
 * one card, and every stop lands on a card.
 */
export function mountGallery(gallery: HTMLElement, nav: HTMLElement) {
  const cards = Array.from(gallery.querySelectorAll<HTMLElement>('.pcard'));
  const [prev, next] = Array.from(nav.querySelectorAll('button'));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const behavior = (): ScrollBehavior =>
    reducedMotion.matches ? 'auto' : 'smooth';

  const maxScroll = () => gallery.scrollWidth - gallery.clientWidth;
  const startInset = () =>
    parseFloat(getComputedStyle(gallery).scrollPaddingInlineStart) || 0;
  // Where the track rests for each card; the last rests at the far end
  // (it snaps by its right edge, see the stylesheet).
  const offsetOf = (card: HTMLElement) =>
    card === cards.at(-1) && cards.length > 1
      ? maxScroll()
      : Math.min(card.offsetLeft - startInset(), maxScroll());

  const currentIndex = () => {
    const left = gallery.scrollLeft;
    let best = 0;
    cards.forEach((card, index) => {
      const distance = Math.abs(offsetOf(card) - left);
      if (distance < Math.abs(offsetOf(cards[best]) - left)) best = index;
    });
    return best;
  };

  const goTo = (index: number) => {
    const card = cards[Math.max(0, Math.min(cards.length - 1, index))];
    if (card) gallery.scrollTo({ left: offsetOf(card), behavior: behavior() });
  };

  // Free scrolling (drag, wheel) turns snapping off, then hands back to a
  // card once the input stops: the next one in the direction it moved, so
  // a single wheel notch or a short drag still turns the page.
  let settleTimer = 0;
  let origin: number | null = null;
  const release = () => gallery.classList.remove('gallery--free');
  const settle = () => {
    window.clearTimeout(settleTimer);
    const left = gallery.scrollLeft;
    const moved = origin === null ? 0 : left - origin;
    origin = null;
    const offsets = cards.map(offsetOf);
    let index = currentIndex();
    if (moved > 24) {
      index = offsets.findIndex((offset) => offset >= left - 1);
      if (index < 0) index = cards.length - 1;
    } else if (moved < -24) {
      index = offsets.findLastIndex((offset) => offset <= left + 1);
      if (index < 0) index = 0;
    }
    goTo(index);
    settleTimer = window.setTimeout(release, reducedMotion.matches ? 0 : 450);
  };
  const free = () => {
    window.clearTimeout(settleTimer);
    origin ??= gallery.scrollLeft;
    gallery.classList.add('gallery--free');
  };

  const sync = () => {
    const overflowing = maxScroll() > 2;
    nav.hidden = !overflowing;
    prev.disabled = gallery.scrollLeft <= 2;
    next.disabled = gallery.scrollLeft >= maxScroll() - 2;
  };
  let frame = 0;
  gallery.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    },
    { passive: true },
  );
  window.addEventListener('resize', sync, { passive: true });
  sync();

  nav.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    goTo(currentIndex() + Number(button.dataset.step));
  });

  gallery.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in steps) goTo(currentIndex() + steps[event.key]);
    else if (event.key === 'Home') goTo(0);
    else if (event.key === 'End') goTo(cards.length - 1);
    else return;
    event.preventDefault();
  });

  // A vertical wheel moves the track while it can still move that way, and
  // lets the page scroll at either end. Trackpads already send sideways
  // deltas, so a mostly-horizontal gesture is left alone. Off entirely when
  // the reader asked for less motion.
  let wheelTimer = 0;
  gallery.addEventListener(
    'wheel',
    (event) => {
      if (reducedMotion.matches || event.ctrlKey) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaY;
      const room =
        delta > 0 ? maxScroll() - gallery.scrollLeft : gallery.scrollLeft;
      if (room <= 1) return;
      event.preventDefault();
      free();
      gallery.scrollLeft += delta;
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(settle, 140);
    },
    { passive: false },
  );

  // Mouse drag. Touch and pen already scroll natively.
  let drag: { x: number; left: number; moved: boolean } | null = null;
  gallery.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, left: gallery.scrollLeft, moved: false };
  });
  gallery.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 5) return;
      drag.moved = true;
      free();
      gallery.classList.add('gallery--dragging');
      gallery.setPointerCapture(event.pointerId);
    }
    gallery.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    gallery.classList.remove('gallery--dragging');
    if (!moved) return;
    settle();
    // The click that ends a drag is not a click on the card under it. It
    // fires right after pointerup, so the flag only has to outlive this task.
    swallowClick = true;
    window.setTimeout(() => (swallowClick = false), 0);
  };
  let swallowClick = false;
  gallery.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
  gallery.addEventListener('pointerup', endDrag);
  gallery.addEventListener('pointercancel', endDrag);
}
