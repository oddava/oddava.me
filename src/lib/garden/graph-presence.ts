/**
 * Modal presence in the manner of Obsidian's: the surface rises a few percent
 * as it fades in and sinks back as it fades out. The graph inside blooms on its
 * own clock, so the surface never has to resize or reproject a canvas.
 */
const ENTER = { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
const EXIT = { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)' };
const REST_SCALE = 0.965;
const running = new WeakMap<HTMLElement, Animation[]>();

/**
 * Fade `panel` and its backdrop in or out. Resolves `true` once the motion
 * lands, or `false` when a later call superseded it. A reversal starts from
 * what is on screen, never from a keyframe endpoint, so it cannot jump.
 * `origin` (viewport coordinates) is where the surface grows from.
 */
export function animatePresence(
  panel: HTMLElement,
  open: boolean,
  origin?: { x: number; y: number },
): Promise<boolean> {
  const previous = running.get(panel);
  let opacity = open ? 0 : 1;
  let backdrop = opacity;
  let scale = open ? REST_SCALE : 1;
  if (previous) {
    const style = getComputedStyle(panel);
    opacity = parseFloat(style.opacity);
    scale =
      style.transform === 'none' ? 1 : new DOMMatrixReadOnly(style.transform).a;
    const behind = parseFloat(getComputedStyle(panel, '::backdrop').opacity);
    backdrop = Number.isFinite(behind) ? behind : opacity;
    previous.forEach((animation) => animation.cancel());
    running.delete(panel);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches)
    return Promise.resolve(true);
  const target = open ? 1 : 0;
  const timing = open ? ENTER : EXIT;
  const box = panel.getBoundingClientRect();
  const transformOrigin = origin
    ? `${origin.x - box.left}px ${origin.y - box.top}px`
    : 'center';
  const options: KeyframeAnimationOptions = {
    // A reversal covers only the distance left, at the same pace.
    duration: timing.duration * Math.max(0.35, Math.abs(target - opacity)),
    easing: timing.easing,
    fill: 'forwards',
  };
  const animations = [
    panel.animate(
      [
        { opacity, transform: `scale(${scale})`, transformOrigin },
        {
          opacity: target,
          transform: `scale(${open ? 1 : REST_SCALE})`,
          transformOrigin,
        },
      ],
      options,
    ),
  ];
  try {
    animations.push(
      panel.animate([{ opacity: backdrop }, { opacity: target }], {
        ...options,
        pseudoElement: '::backdrop',
      }),
    );
  } catch {
    // Without pseudo-element animation the backdrop simply appears with the surface.
  }
  running.set(panel, animations);
  // Animations finish on a rendered frame. When frames stall (a busy main
  // thread, a slow compositor) the surface still lands on time.
  const deadline = setTimeout(
    () => {
      if (running.get(panel) === animations)
        animations.forEach((animation) => animation.finish());
    },
    (options.duration as number) + 100,
  );
  return Promise.all(animations.map((animation) => animation.finished)).then(
    () => {
      clearTimeout(deadline);
      if (running.get(panel) !== animations) return false;
      running.delete(panel);
      // The caller closes the dialog in this same microtask checkpoint, before
      // any paint, so releasing the held end state here cannot flash.
      animations.forEach((animation) => animation.cancel());
      return true;
    },
    () => {
      clearTimeout(deadline);
      return false;
    },
  );
}
