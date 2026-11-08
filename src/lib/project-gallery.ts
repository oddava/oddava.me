/**
 * The sideways gallery's behaviour, for /projects and home's strip. The track
 * scrolls natively and the stylesheet makes it stop on every card, one at a
 * time (`scroll-snap-stop: always`) — touch swipe and Tab into a card work
 * without this. On top of that: the buttons, the arrow keys and each
 * sideways wheel gesture glide one card, and a mouse can drag it, gliding on
 * release to the next card in the drag's direction.
 *
 * A plain vertical wheel is left to the page. The track spans the whole
 * viewport, so turning it sideways would trap anyone scrolling down past it.
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

  const nearestIndex = () => {
    const left = gallery.scrollLeft;
    let best = 0;
    cards.forEach((card, index) => {
      const distance = Math.abs(offsetOf(card) - left);
      if (distance < Math.abs(offsetOf(cards[best]) - left)) best = index;
    });
    return best;
  };

  // The card a glide is heading for, so a second press while it moves
  // steps on from there rather than from wherever the glide has got to.
  let target: number | null = null;
  const currentIndex = () => target ?? nearestIndex();

  // Snapping is off while a drag holds the track and while it glides home
  // afterwards; it comes back once the track rests on a card.
  let restTimer = 0;
  const rest = () => {
    // Moving the track by hand during a drag can end a scroll too.
    if (drag?.moved) return;
    window.clearTimeout(restTimer);
    target = null;
    gallery.classList.remove('gallery--free');
  };
  gallery.addEventListener('scrollend', rest);

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(cards.length - 1, index));
    const card = cards[clamped];
    if (!card) return;
    target = clamped;
    gallery.scrollTo({ left: offsetOf(card), behavior: behavior() });
    // No scrollend when the track is already there, nor in browsers
    // without the event.
    window.clearTimeout(restTimer);
    restTimer = window.setTimeout(rest, 700);
  };

  const sync = () => {
    nav.hidden = maxScroll() <= 2;
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

  // A sideways wheel — a trackpad swipe, a tilt wheel, shift+wheel — turns
  // exactly one card per gesture. Left to itself the track would take each
  // event as its own scroll and a quick swipe would run past several cards.
  // A gesture ends when its events (momentum included) go quiet.
  let wheelSum = 0;
  let wheelSpent = false;
  let wheelQuiet = 0;
  gallery.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) return;
      const sideways =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.shiftKey
            ? event.deltaY
            : 0;
      if (!sideways) return;
      event.preventDefault();
      window.clearTimeout(wheelQuiet);
      wheelQuiet = window.setTimeout(() => {
        wheelSum = 0;
        wheelSpent = false;
      }, 220);
      if (wheelSpent) return;
      wheelSum +=
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? sideways * 16
          : sideways;
      if (Math.abs(wheelSum) < 24) return;
      wheelSpent = true;
      goTo(currentIndex() + Math.sign(wheelSum));
    },
    { passive: false },
  );

  // Mouse drag. Touch and pen already scroll natively.
  let drag: { x: number; left: number; from: number; moved: boolean } | null =
    null;
  gallery.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = {
      x: event.clientX,
      left: gallery.scrollLeft,
      from: currentIndex(),
      moved: false,
    };
  });
  gallery.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 5) return;
      drag.moved = true;
      window.clearTimeout(restTimer);
      gallery.classList.add('gallery--free', 'gallery--dragging');
      gallery.setPointerCapture(event.pointerId);
    }
    gallery.scrollLeft = drag.left - dx;
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag) return;
    const { moved, from, x } = drag;
    drag = null;
    gallery.classList.remove('gallery--dragging');
    if (!moved) return;
    // A short pull is enough to turn the page; anything less springs back.
    const dx = event.clientX - x;
    goTo(dx < -40 ? from + 1 : dx > 40 ? from - 1 : from);
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
