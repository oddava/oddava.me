import { drawGraphTransition, type GraphFrame } from './graph-transition-frame';

type Spring = { value: number; velocity: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

// Exact critically damped integration retains momentum on a reversal and is
// independent of refresh rate. No canned easing or overshoot at either rest.
function step(spring: Spring, target: number, dt: number) {
  const frequency = 42;
  const displacement = spring.value - target;
  const impulse = spring.velocity + frequency * displacement;
  const decay = Math.exp(-frequency * dt);
  spring.value = target + (displacement + impulse * dt) * decay;
  spring.velocity = (spring.velocity - frequency * impulse * dt) * decay;
}

/** One clock owns the shell, mask, backdrop, depth and graph projection. */
export function morphGraph({
  panel,
  slot,
  mini,
  full,
  opening,
  onRest,
  refreshFrames,
  advanceFrame,
  onDirection,
}: {
  panel: HTMLDialogElement;
  slot: HTMLElement;
  mini: GraphFrame;
  full: GraphFrame;
  opening: boolean;
  advanceFrame: (now: number, frame: GraphFrame, aperture: number) => void;
  onDirection: (open: boolean) => void;
  onRest: (
    open: boolean,
    momentum?: ReadonlyMap<string, { x: number; y: number }>,
  ) => void;
  refreshFrames: (
    miniWidth: number,
    miniHeight: number,
    fullWidth: number,
    fullHeight: number,
  ) => { mini: GraphFrame; full: GraphFrame };
}) {
  const overlay = document.createElement('canvas');
  overlay.className = 'interactive-graph__transition';
  overlay.setAttribute('aria-hidden', 'true');
  const savedStyle = panel.style.cssText;
  const fullRect = panel.getBoundingClientRect();
  const styles = getComputedStyle(panel);
  let radius = parseFloat(styles.borderTopLeftRadius) || 0;
  let destination = fullRect;
  const content = panel.querySelector('canvas[role="group"]')!;
  let contentRect = content.getBoundingClientRect();
  const insets = () => ({
    left: contentRect.left - destination.left,
    top: contentRect.top - destination.top,
    right: destination.right - contentRect.right,
    bottom: destination.bottom - contentRect.bottom,
  });
  let fullInset = insets();
  const home = () => slot.getBoundingClientRect();
  let origin = home();
  let measuredHomeWidth = origin.width;
  let measuredHomeHeight = origin.height;
  const start = opening ? origin : destination;
  const springs = {
    x: { value: start.x, velocity: 0 },
    y: { value: start.y, velocity: 0 },
    width: { value: start.width, velocity: 0 },
    height: { value: start.height, velocity: 0 },
    progress: { value: opening ? 0 : 1, velocity: 0 },
  };
  let target = opening ? 1 : 0;
  let frame = 0;
  let last = performance.now();
  let disposed = false;
  let picture = opening ? mini : full;
  const momentum = new Map<string, { x: number; y: number }>();
  const previousPoints = new Map<string, { x: number; y: number }>();
  let correction: { frame: GraphFrame; progress: number } | undefined;
  const correctionSpring: Spring = { value: 1, velocity: 0 };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  panel.append(overlay);
  // Position moves on the compositor; only the clipping aperture changes size.
  panel.style.inset = 'auto';
  panel.style.margin = '0';
  panel.style.maxWidth = 'none';
  panel.style.left = '0';
  panel.style.top = '0';
  panel.style.padding = '0';
  panel.style.borderWidth = '0';
  panel.style.willChange = 'transform';
  panel.dataset.morphing = '';
  slot.dataset.morphing = '';

  function hasHome() {
    return (
      origin.width > 0 &&
      origin.height > 0 &&
      origin.bottom > 0 &&
      origin.right > 0 &&
      origin.top < innerHeight &&
      origin.left < innerWidth
    );
  }
  function cleanup() {
    disposed = true;
    cancelAnimationFrame(frame);
    abort.abort();
    observer.disconnect();
    overlay.remove();
    panel.style.cssText = savedStyle;
    delete panel.dataset.morphing;
    delete panel.dataset.closing;
    delete slot.dataset.morphing;
  }
  function finish() {
    if (disposed) return;
    cleanup();
    // onRest paints the real canvas synchronously before this task can paint.
    onRest(target === 1, motion.matches ? undefined : momentum);
  }
  function render(dt = 0) {
    const p = clamp(springs.progress.value);
    const { x, y, width, height } = springs;
    panel.style.width = `${width.value}px`;
    panel.style.height = `${height.value}px`;
    panel.style.transform = `translate3d(${x.value}px, ${y.value}px, 0)`;
    const rounding = radius * p + 5 * Math.sin(Math.PI * p);
    panel.style.borderRadius = `${rounding}px`;
    // Clip the graph independently of the surface's soft, external shadow.
    overlay.style.clipPath = `inset(0 round ${rounding}px)`;
    panel.style.boxShadow = `0 ${12 * p}px ${36 * p}px rgb(0 0 0 / ${0.2 * p}), inset 0 0 0 1px color-mix(in srgb, var(--color-rule) ${p * 100}%, transparent), inset 0 -1px var(--color-rule)`;
    panel.style.setProperty('--graph-presence', String(p));
    panel.style.setProperty(
      '--graph-controls',
      String(clamp((p - 0.55) / 0.45)),
    );
    // Content is reprojected, not bitmap-scaled: circles stay circular and
    // shared nodes/edges retain identity while the clipping surface changes.
    const left = fullInset.left * p;
    const top = fullInset.top * p;
    const right = (origin.width - mini.width) * (1 - p) + fullInset.right * p;
    const bottom =
      (origin.height - mini.height) * (1 - p) + fullInset.bottom * p;
    const contentWidth = Math.max(1, width.value - left - right);
    const contentHeight = Math.max(1, height.value - top - bottom);
    panel.style.setProperty('--graph-inset-top', `${top}px`);
    panel.style.setProperty('--graph-inset-right', `${fullInset.right * p}px`);
    panel.style.setProperty('--graph-inset-left', `${left}px`);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${contentWidth}px`;
    overlay.style.height = `${contentHeight}px`;
    picture = drawGraphTransition(
      overlay,
      mini,
      full,
      p,
      contentWidth,
      contentHeight,
      correction,
    );
    const transfer = 1 - Math.exp(-dt / 0.025);
    for (const node of picture.nodes) {
      const pointX = x.value + left + node.x;
      const pointY = y.value + top + node.y;
      const previous = previousPoints.get(node.id);
      const velocity = momentum.get(node.id) ?? { x: 0, y: 0 };
      if (previous && dt > 0) {
        velocity.x += ((pointX - previous.x) / dt - velocity.x) * transfer;
        velocity.y += ((pointY - previous.y) / dt - velocity.y) * transfer;
        momentum.set(node.id, velocity);
      }
      if (previous) {
        previous.x = pointX;
        previous.y = pointY;
      } else previousPoints.set(node.id, { x: pointX, y: pointY });
    }
  }
  function tick(now: number) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    if (motion.matches || !hasHome()) {
      if (!origin.width || !origin.height) target = 0;
      finish();
      return;
    }
    const rect = target ? destination : origin;
    let settled = true;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      step(springs[key], rect[key], dt);
      if (
        Math.abs(springs[key].value - rect[key]) > 0.5 ||
        Math.abs(springs[key].velocity) > 20
      )
        settled = false;
    }
    step(springs.progress, target, dt);
    advanceFrame(now, full, clamp(springs.progress.value));
    if (correction) {
      step(correctionSpring, 1, dt);
      correction.progress = clamp(correctionSpring.value);
      if (1 - correction.progress > 0.0005) settled = false;
      else correction = undefined;
    }
    if (Math.abs(springs.progress.value - target) > 0.0005) settled = false;
    if (settled) {
      finish();
      return;
    }
    render(dt);
    frame = requestAnimationFrame(tick);
  }
  function resize() {
    // Measure CSS's actual modal destination without painting the temporary
    // layout; the current springs and their velocity remain untouched.
    const current = panel.style.cssText;
    panel.style.cssText = savedStyle;
    destination = panel.getBoundingClientRect();
    contentRect = content.getBoundingClientRect();
    fullInset = insets();
    radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
    origin = home();
    measuredHomeWidth = origin.width;
    measuredHomeHeight = origin.height;
    if (origin.width && origin.height) {
      // Preserve the currently drawn projection while the newly measured
      // camera endpoints ease in; resizing never swaps in a stale bitmap.
      correction = { frame: picture, progress: 0 };
      correctionSpring.value = 0;
      correctionSpring.velocity = 0;
      ({ mini, full } = refreshFrames(
        Math.round(origin.width),
        Math.max(1, Math.round(origin.height) - 1),
        content.clientWidth,
        content.clientHeight,
      ));
    }
    panel.style.cssText = current;
  }
  const observer = new ResizeObserver(() => {
    const next = home();
    if (next.width !== measuredHomeWidth || next.height !== measuredHomeHeight)
      resize();
    else origin = next;
  });
  observer.observe(slot);
  window.addEventListener('resize', resize, { signal: abort.signal });
  window.addEventListener(
    'scroll',
    () => {
      origin = home();
    },
    { capture: true, passive: true, signal: abort.signal },
  );
  window.visualViewport?.addEventListener('resize', resize, {
    signal: abort.signal,
  });
  motion.addEventListener(
    'change',
    () => {
      if (motion.matches) finish();
    },
    { signal: abort.signal },
  );
  function setOpen(open: boolean) {
    if (disposed) return;
    target = open ? 1 : 0;
    onDirection(open);
    panel.toggleAttribute('data-closing', !open);
  }
  setOpen(opening);
  // Paint the origin in the same task as showModal: never expose a full-size
  // modal for one frame before the opening flight begins.
  render();
  frame = requestAnimationFrame(tick);
  return { setOpen, destroy: cleanup };
}
