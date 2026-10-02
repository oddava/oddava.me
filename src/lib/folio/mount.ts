import {
  folioAccents,
  folioWaypoints,
  folioStars,
  folioPath,
  folioOrbit,
  type FolioView,
} from './geometry';

import {
  accentTarget,
  echoAt,
  stepAccent,
  stillAccent,
  type Echo,
} from './motion';

const mounted = new WeakMap<HTMLElement, () => void>();

/** Six rigid motifs and sparse dust share one bounded gesture loop. Native CSS handles ambient
 * breathing; the JS loop sleeps as soon as the interaction has settled. */
export function mountFolio(root: HTMLElement): (() => void) | null {
  mounted.get(root)?.();
  const svg = root.querySelector<SVGSVGElement>('svg');
  const trace = root.querySelector<SVGPathElement>('[data-folio-trace]');
  if (!svg || !trace) return null;
  const accents = Array.from(
    root.querySelectorAll<SVGGElement>('[data-folio-accent]'),
  );
  const trail = root.querySelector<SVGPathElement>('[data-folio-trail]');
  const states = accents.map(stillAccent);
  const stars = Array.from(
    root.querySelectorAll<SVGGElement>('[data-folio-star]'),
    (element) => ({
      element,
      x: 0,
      y: 0,
      shiftX: 0,
      shiftY: 0,
      light: 0,
    }),
  );
  const nav = document.querySelector<HTMLElement>('[data-folio-nav]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = matchMedia('(forced-colors: active)');
  const controller = new AbortController();
  const { signal } = controller;
  let destroyed = false;
  let waitingForFonts = false;
  let mobile = false;
  let burst: Animation | undefined;
  let lastBurst = -1000;
  let resizeFrame = 0;
  let frame = 0;
  let pointer: { x: number; y: number; vx: number; vy: number } | null = null;
  let inputTime = 0;
  let last = 0;
  let lastEcho = -1000;
  let entered = false;
  let echoes: Echo[] = [];
  let nearest = 0;
  let distance = Infinity;
  let edgeDirty = false;
  let rimAlpha = 0;
  let tail = 0;
  let bounds: DOMRect;
  let positions: [number, number][] = [];
  let edge: [number, number][] = [];

  function paint() {
    accents.forEach((accent, i) => {
      const state = states[i]!;
      accent.style.setProperty('--shift-x', `${state.x.toFixed(2)}px`);
      accent.style.setProperty('--shift-y', `${state.y.toFixed(2)}px`);
      accent.style.setProperty('--turn', `${state.turn.toFixed(2)}deg`);
      accent.style.setProperty('--open', state.open.toFixed(3));
      accent.style.setProperty('--echo', state.echo.toFixed(3));
      accent.style.opacity = Math.min(
        1,
        0.65 + Math.max(0, state.open) * 0.3,
      ).toFixed(3);
    });
  }

  function reset() {
    burst?.cancel();
    burst = undefined;
    pointer = null;
    echoes = [];
    entered = false;
    rimAlpha = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    states.forEach((state) => Object.assign(state, stillAccent()));
    stars.forEach((star) => {
      star.shiftX = star.shiftY = star.light = 0;
      star.element.removeAttribute('style');
    });
    paint();
    trace!.style.opacity = '0';
    if (trail) trail.style.opacity = '0';
    root.toggleAttribute(
      'data-sleep',
      document.hidden || motion.matches || contrast.matches,
    );
  }

  function wake() {
    if (
      !frame &&
      !mobile &&
      !destroyed &&
      !document.hidden &&
      !motion.matches &&
      !contrast.matches
    ) {
      last = performance.now();
      frame = requestAnimationFrame(update);
    }
  }

  function leave() {
    pointer = null;
    entered = false;
    wake();
  }

  function resize() {
    if (destroyed || document.hidden || waitingForFonts) return;
    // Keep navigation out of the measured flow without revealing it yet.
    if (nav) nav.dataset.measuring = '';
    bounds = svg!.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    mobile = bounds.width < 900;
    const parts = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.home-hero__name, .home-hero__tagline',
      ),
      (part) => part.getBoundingClientRect(),
    );
    // Layout can start font requests even when FontFaceSet was initially loaded.
    // Wait after the layout read, on initial loads and history restores alike.
    if (document.fonts.status === 'loading') {
      waitingForFonts = true;
      root.removeAttribute('data-ready');
      nav?.removeAttribute('data-ready');
      void document.fonts.ready.then(() => {
        waitingForFonts = false;
        resize();
      });
      return;
    }
    const left = parts.length
      ? Math.min(...parts.map((part) => part.left)) - bounds.left
      : bounds.width * 0.3;
    const right = parts.length
      ? Math.max(...parts.map((part) => part.right)) - bounds.left
      : bounds.width * 0.7;
    const top = parts.length
      ? Math.min(...parts.map((part) => part.top)) - bounds.top
      : bounds.height * 0.35;
    const bottom = parts.length
      ? Math.max(...parts.map((part) => part.bottom)) - bounds.top
      : bounds.height * 0.65;
    const view: FolioView = {
      width: bounds.width,
      height: bounds.height,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
      quietWidth: right - left + 24,
      quietHeight: bottom - top + 24,
    };
    svg!.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
    if (nav) {
      folioWaypoints(view).forEach(([x, y], i) => {
        const link = nav.children[i] as HTMLElement | undefined;
        link?.style.setProperty('--waypoint-x', `${x + bounds.left}px`);
        link?.style.setProperty('--waypoint-y', `${y + bounds.top}px`);
      });
    }
    const path = folioPath(view);
    root
      .querySelectorAll('[data-folio-island]')
      .forEach((island) => island.setAttribute('d', path));
    root
      .querySelectorAll('[data-folio-orbit]')
      .forEach((orbit) => orbit.setAttribute('d', folioOrbit(view)));
    positions = folioAccents(view);
    accents.forEach((accent, i) =>
      accent.setAttribute('transform', `translate(${positions[i]!.join(' ')})`),
    );
    folioStars(view).forEach(([x, y, size], i) => {
      const star = stars[i];
      if (!star) return;
      star.x = x;
      star.y = y;
      star.element.setAttribute('transform', `translate(${x} ${y})`);
      star.element.setAttribute('visibility', size ? 'visible' : 'hidden');
    });
    // Cache uniformly spaced edge samples once; pointer frames never measure SVG.
    const length = mobile ? 0 : trace!.getTotalLength();
    edge = Array.from({ length: mobile ? 0 : 256 }, (_, i) => {
      const point = trace!.getPointAtLength((i / 256) * length);
      return [point.x, point.y];
    });
    reset();
    root.dataset.ready = '';
    if (nav) nav.dataset.ready = '';
  }

  function update(now: number) {
    frame = 0;
    if (destroyed || document.hidden || motion.matches || contrast.matches)
      return;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    const speed = pointer
      ? Math.min(1, Math.hypot(pointer.vx, pointer.vy) / 1400)
      : 0;
    if (pointer && now - lastEcho > 180 && (entered || speed > 0.18)) {
      if (echoes.length === 4) echoes.shift();
      echoes.push({
        x: pointer.x,
        y: pointer.y,
        age: 0,
        power: 0.45 + speed * 0.55,
      });
      lastEcho = now;
      entered = false;
    }
    for (const echo of echoes) echo.age += dt;
    echoes = echoes.filter((echo) => echo.age < 0.95);
    let moving = false;
    states.forEach((state, i) => {
      const [x, y] = positions[i]!;
      const cue = echoes.reduce((sum, echo) => sum + echoAt(echo, x, y), 0);
      moving =
        stepAccent(
          state,
          accentTarget(i, x, y, pointer, Math.min(0.8, cue)),
          dt,
        ) || moving;
    });
    for (const star of stars) {
      const dx = pointer ? star.x - pointer.x : 0;
      const dy = pointer ? star.y - pointer.y : 0;
      const near = pointer ? Math.max(0, 1 - Math.hypot(dx, dy) / 150) ** 2 : 0;
      const follow = 1 - Math.exp(-dt * 5);
      const x = dx * near * 0.06;
      const y = dy * near * 0.06;
      if (
        Math.abs(x - star.shiftX) +
          Math.abs(y - star.shiftY) +
          Math.abs(near - star.light) <
        0.005
      )
        continue;
      moving = true;
      star.shiftX += (x - star.shiftX) * follow;
      star.shiftY += (y - star.shiftY) * follow;
      star.light += (near - star.light) * follow;
      star.element.style.setProperty('--dust-x', `${star.shiftX.toFixed(2)}px`);
      star.element.style.setProperty('--dust-y', `${star.shiftY.toFixed(2)}px`);
      star.element.style.opacity = (0.72 + star.light * 0.28).toFixed(3);
    }
    paint();
    if (pointer && edgeDirty) {
      distance = Infinity;
      edge.forEach(([x, y], i) => {
        const squared = (x - pointer!.x) ** 2 + (y - pointer!.y) ** 2;
        if (squared < distance) {
          distance = squared;
          nearest = i;
        }
      });
      edgeDirty = false;
    }
    const targetAlpha = pointer
      ? Math.max(0, 1 - Math.sqrt(distance) / 250) * 0.9
      : 0;
    rimAlpha += (targetAlpha - rimAlpha) * (1 - Math.exp(-dt * 14));
    const along = (nearest / edge.length) * 1000;
    const lag = ((along - tail + 1500) % 1000) - 500;
    tail = (tail + lag * (1 - Math.exp(-dt * 7)) + 1000) % 1000;
    const length = 34 + speed * 50;
    trace!.style.strokeDasharray = `${length.toFixed(1)} ${(1000 - length).toFixed(1)}`;
    trace!.style.strokeDashoffset = `${length / 2 - along}`;
    trace!.style.opacity = rimAlpha.toFixed(3);
    if (trail) {
      trail.style.strokeDashoffset = `${17 - tail}`;
      trail.style.opacity = (rimAlpha * 0.4).toFixed(3);
    }
    if (pointer) {
      pointer.vx *= Math.exp(-dt * 9);
      pointer.vy *= Math.exp(-dt * 9);
    }
    if (
      moving ||
      echoes.length ||
      speed > 0.005 ||
      Math.abs(targetAlpha - rimAlpha) > 0.001 ||
      (rimAlpha > 0.001 && Math.abs(lag) > 0.2)
    ) {
      frame = requestAnimationFrame(update);
    }
  }

  const interactive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      'a, button, input, textarea, select, [contenteditable], [role=button], .spotify-widget-positioner, .home-hero__name, .home-hero__tagline, .home-hero__cta',
    );
  const move = (event: PointerEvent) => {
    if (
      destroyed ||
      motion.matches ||
      contrast.matches ||
      document.hidden ||
      !positions.length ||
      // Chromium can send a zero-motion pointermove after restoring a document.
      // A return should keep the neutral pose until the user actually moves.
      (event.type === 'pointermove' &&
        event.movementX === 0 &&
        event.movementY === 0)
    )
      return;
    if (interactive(event.target)) {
      leave();
      return;
    }
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (mobile) {
      // One short compositor animation; no star updates, springs, or edge scans.
      if (event.timeStamp - lastBurst < 500) return;
      const index = (nav ? [4] : [1, 4, 5]).reduce(
        (nearest, i) =>
          Math.hypot(positions[i]![0] - x, positions[i]![1] - y) <
          Math.hypot(positions[nearest]![0] - x, positions[nearest]![1] - y)
            ? i
            : nearest,
        nav ? 4 : 1,
      );
      const element = accents[index]?.querySelector<SVGGElement>(
        '.folio-accent__response',
      );
      if (!element) return;
      lastBurst = event.timeStamp;
      burst?.cancel();
      burst = element.animate(
        [
          { transform: 'translateY(0px) rotate(0deg)', opacity: 1 },
          {
            transform: 'translateY(-4px) rotate(7deg)',
            opacity: 0.8,
            offset: 0.3,
          },
          { transform: 'translateY(0px) rotate(0deg)', opacity: 1 },
        ],
        { duration: 650, easing: 'ease-out' },
      );
      return;
    }
    const elapsed = Math.max(8, event.timeStamp - inputTime) / 1000;
    const vx = pointer
      ? Math.max(-2400, Math.min(2400, (x - pointer.x) / elapsed))
      : 0;
    const vy = pointer
      ? Math.max(-2400, Math.min(2400, (y - pointer.y) / elapsed))
      : 0;
    entered ||= !pointer;
    pointer = { x, y, vx, vy };
    inputTime = event.timeStamp;
    edgeDirty = true;
    wake();
  };
  document.addEventListener('pointermove', move, { signal, passive: true });
  document.addEventListener('pointerdown', move, { signal, passive: true });
  document.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerType !== 'mouse') leave();
    },
    { signal, passive: true },
  );
  document.addEventListener('pointercancel', leave, { signal });
  document.documentElement.addEventListener('pointerleave', leave, { signal });
  window.addEventListener('blur', reset, { signal });
  window.addEventListener('pagehide', reset, { signal });
  window.addEventListener('pageshow', resize, { signal });
  const scheduleResize = () => {
    if (!resizeFrame && !destroyed && !document.hidden)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
  };
  window.addEventListener('resize', scheduleResize, { signal, passive: true });
  window.addEventListener('scroll', scheduleResize, { signal, passive: true });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
        reset();
      } else resize();
    },
    { signal },
  );
  motion.addEventListener('change', reset, { signal });
  contrast.addEventListener('change', reset, { signal });
  const observer = new ResizeObserver(scheduleResize);
  const hero = document.querySelector('.home-hero');
  if (hero) observer.observe(hero);
  const destroy = () => {
    destroyed = true;
    cancelAnimationFrame(resizeFrame);
    reset();
    controller.abort();
    observer.disconnect();
    mounted.delete(root);
  };
  document.addEventListener('astro:before-swap', destroy, {
    signal,
    once: true,
  });
  resize();
  mounted.set(root, destroy);
  return destroy;
}
