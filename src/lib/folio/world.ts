import type { FolioView } from './geometry';
import {
  createWorld,
  disturbWorld,
  stepWorld,
  type WorldKind,
  type WorldPointer,
} from './world-physics';

export const WORLD_MEDIA =
  '(min-width: 1280px) and (min-height: 700px) and (hover: hover) and (pointer: fine)';
const NS = 'http://www.w3.org/2000/svg';
const marks: Record<WorldKind, string> = {
  star: 'M0-8Q1-1 7 0Q1 1 0 8Q-1 1-7 0Q-1-1 0-8Z',
  moon: 'M11-15C-15-24-27 10-6 17C3 21 13 15 16 7C-4 15-12-5 11-15ZM-21 9Q-9 26 10 20',
  satellite: 'M-3 0Q-3-4 0-3Q4-3 3 1Q2 4-1 3Q-4 2-3 0Z',
};
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, value);
  return element;
}

/** A tiny SVG renderer around the pure solver. No layout reads in animation frames. */
export function mountWorld(root: HTMLElement) {
  const controller = new AbortController();
  const { signal } = controller;
  const svg = svgElement('svg', {
    class: 'folio-world',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  root.append(svg);
  let view: FolioView;
  let world = createWorld({
    width: 0,
    height: 0,
    centerX: 0,
    centerY: 0,
    quietWidth: 0,
    quietHeight: 0,
  });
  let nodes: SVGGElement[] = [];
  let links: SVGPathElement[] = [];
  let trails: SVGPathElement[] = [];
  let history: { x: number; y: number }[][] = [];
  let details: SVGPathElement[] = [];
  let rings: SVGCircleElement[] = [];
  let name: SVGTextElement | null = null;
  let pointer: WorldPointer | null = null;
  let held = -1;
  let capture: Element | null = null;
  let pointerId = -1;
  let down: { x: number; y: number; time: number } | null = null;
  let travel = 0;
  let frame = 0;
  let last = 0;
  let inputTime = 0;
  let accumulator = 0;
  let destroyed = false;
  let trailTime = 0;
  let idleTimer = 0;
  let overPlayer = false;
  let playerWakeAt = -Infinity;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const allowed = () =>
    !destroyed && !document.hidden && !reduced.matches && !forced.matches;

  // One exhale per idle period. Pointer activity arms the next; no polling loop.
  function armIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    if (!allowed() || !world.bodies.length) return;
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      if (!allowed() || held >= 0) return;
      const satellite = world.bodies.find((body) => body.kind === 'satellite');
      if (satellite) satellite.vx += 5;
      wake();
    }, 30000);
  }
  function release() {
    held = -1;
    down = null;
    if (capture?.hasPointerCapture(pointerId))
      capture.releasePointerCapture(pointerId);
    capture = null;
    svg.removeAttribute('data-dragging');
  }
  function paint() {
    world.bodies.forEach((body, i) => {
      nodes[i]!.setAttribute(
        'transform',
        `translate(${body.x.toFixed(2)} ${body.y.toFixed(2)}) rotate(${((body.angle * 180) / Math.PI).toFixed(2)})`,
      );
      nodes[i]!.style.opacity = String(0.42 + body.light * 0.36);
      details[i]!.style.opacity = String(Math.min(0.7, body.curiosity * 0.65));
      const points = history[i]!;
      trails[i]!.setAttribute(
        'd',
        points.length > 1
          ? points
              .map(
                (p, n) => `${n ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
              )
              .join(' ')
          : '',
      );
      trails[i]!.style.opacity = String(
        Math.min(0.2, Math.hypot(body.vx, body.vy) / 900),
      );
    });
    world.links.forEach((link, i) => {
      const a = world.bodies[link.a]!;
      const b = world.bodies[link.b]!;
      const stretched = Math.hypot(a.x - b.x, a.y - b.y) / link.length;
      const bow = Math.max(0, 1.15 - stretched) * 35;
      links[i]!.setAttribute(
        'd',
        `M${a.x} ${a.y}Q${(a.x + b.x) / 2 + bow} ${(a.y + b.y) / 2 + bow} ${b.x} ${b.y}`,
      );
      links[i]!.style.opacity = String(
        (a.kind === 'moon' ? 0.08 : 0.14) + Math.max(a.light, b.light) * 0.28,
      );
    });
    if (name) {
      // The constellation names itself only while some part of it is lit.
      const lit = world.bodies.reduce(
        (max, body) => (body.kind === 'star' ? Math.max(max, body.light) : max),
        0,
      );
      name.style.opacity = String(Math.min(0.85, lit * 1.1));
    }
    rings.forEach((ring, i) => {
      const pulse = world.pulses[i];
      ring.style.opacity = pulse
        ? String(Math.max(0, 1 - pulse.age / 1.4) * 0.22)
        : '0';
      if (pulse) {
        ring.setAttribute('cx', String(pulse.x));
        ring.setAttribute('cy', String(pulse.y));
        ring.setAttribute('r', String(pulse.age * 180));
      }
    });
  }
  function wake() {
    if (!frame && allowed()) {
      const now = performance.now();
      // Cooldowns elapse while the solver sleeps, without running idle frames.
      world.moonCooldown = Math.max(
        0,
        world.moonCooldown - (now - last) / 1000,
      );
      last = now;
      frame = requestAnimationFrame(update);
    }
  }
  function update(now: number) {
    frame = 0;
    if (!allowed()) return;
    accumulator += Math.min((now - last) / 1000, 0.05);
    last = now;
    // High-refresh displays may paint before a complete physics step accumulates.
    let active = accumulator < 1 / 120;
    while (accumulator >= 1 / 120) {
      active = stepWorld(world, pointer, held, 1 / 120) || active;
      if (pointer) {
        pointer.vx *= 0.94;
        pointer.vy *= 0.94;
      }
      accumulator -= 1 / 120;
    }
    if (now - trailTime > 45) {
      world.bodies.forEach((b, i) => {
        const points = history[i]!;
        points.push({ x: b.x, y: b.y });
        if (points.length > 9) points.shift();
      });
      trailTime = now;
    }
    paint();
    if (active || held >= 0) frame = requestAnimationFrame(update);
  }
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    accumulator = 0;
    pointer = null;
    overPlayer = false;
    release();
    armIdle();
    if (view) world = createWorld(view);
    history = world.bodies.map(() => []);
    paint();
  }
  function resize(next: FolioView) {
    view = next;
    cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
    overPlayer = false;
    release();
    accumulator = 0;
    world = createWorld(view);
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
    // All secondary effects are clipped to the margins too.
    const clip = svgElement('clipPath', { id: 'folio-world-margins' });
    for (const side of [0, 1]) {
      const body = world.bodies.find((b) =>
        side ? b.homeX > view.centerX : b.homeX < view.centerX,
      );
      if (body)
        clip.append(
          svgElement('rect', {
            x: String(body.minX - 24),
            y: '24',
            width: String(body.maxX - body.minX + 48),
            height: String(view.height - 100),
          }),
        );
    }
    const defs = svgElement('defs');
    defs.append(clip);
    svg.append(defs);
    const layer = svgElement('g', { 'clip-path': 'url(#folio-world-margins)' });
    svg.append(layer);
    links = world.links.map(() => {
      const path = svgElement('path', { class: 'folio-world__thread' });
      layer.append(path);
      return path;
    });
    trails = world.bodies.map(() => {
      const path = svgElement('path', { class: 'folio-world__trail' });
      layer.append(path);
      return path;
    });
    rings = Array.from({ length: 3 }, () => {
      const ring = svgElement('circle', { class: 'folio-world__ripple' });
      layer.append(ring);
      return ring;
    });
    details = [];
    nodes = world.bodies.map((body, i) => {
      const group = svgElement('g', {
        'data-world-body': String(i),
        'data-kind': body.kind,
      });
      const mark = svgElement('path', {
        d: marks[body.kind],
        class: 'folio-world__mark',
      });
      if (body.kind === 'star')
        mark.setAttribute('transform', `scale(${body.radius / 8})`);
      const detail = svgElement('path', {
        d: 'M-12-18l-3-3M15 17l3 3',
        class: 'folio-world__secret',
      });
      const hit = svgElement('circle', {
        r: String(Math.max(15, body.radius + 7)),
        class: 'folio-world__hit',
      });
      group.append(mark, detail, hit);
      layer.append(group);
      details.push(detail);
      return group;
    });
    name = null;
    const stars = world.bodies.filter((body) => body.kind === 'star');
    if (stars.length) {
      name = svgElement('text', {
        class: 'folio-world__name',
        x: String((stars[0]!.minX + stars[0]!.maxX) / 2),
        y: String(Math.max(...stars.map((b) => b.homeY)) + 46),
        'text-anchor': 'middle',
      });
      const title = svgElement('tspan', { x: name.getAttribute('x')! });
      title.textContent = 'felis';
      const note = svgElement('tspan', {
        x: name.getAttribute('x')!,
        dy: '1.5em',
        class: 'folio-world__note',
      });
      note.textContent = 'lost in 1922';
      name.append(title, note);
      layer.append(name);
    }
    history = world.bodies.map(() => []);
    paint();
    armIdle();
  }
  function move(event: PointerEvent) {
    if (!allowed() || event.pointerType !== 'mouse') return;
    armIdle();
    const player =
      event.target instanceof Element
        ? event.target.closest('.spotify-widget-positioner')
        : null;
    if (player && !overPlayer && performance.now() - playerWakeAt > 8000) {
      // Entry-only layout read, outside the animation loop.
      const rect = player.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const nearest = world.bodies.reduce<
        (typeof world.bodies)[number] | undefined
      >(
        (best, body) =>
          !best ||
          Math.hypot(body.x - x, body.y - y) <
            Math.hypot(best.x - x, best.y - y)
            ? body
            : best,
        undefined,
      );
      if (nearest && Math.hypot(nearest.x - x, nearest.y - y) < 300) {
        nearest.vy -= 7 / nearest.mass;
        nearest.spin += 0.1;
        nearest.echo = 0.15;
        playerWakeAt = performance.now();
      }
    }
    overPlayer = !!player;
    if (
      held < 0 &&
      event.target instanceof Element &&
      event.target.closest(
        'a, button, input, textarea, select, [contenteditable], .spotify-widget-positioner',
      )
    ) {
      pointer = null;
      wake();
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    const inMargin = world.bodies.some(
      (b) => x >= b.minX - 20 && x <= b.maxX + 20,
    );
    if (!inMargin && held < 0) {
      pointer = null;
      wake();
      return;
    }
    const dt = Math.max(8, event.timeStamp - inputTime) / 1000;
    const limit = (n: number) => Math.max(-1800, Math.min(1800, n));
    pointer = {
      x,
      y,
      vx: pointer ? limit((x - pointer.x) / dt) : 0,
      vy: pointer ? limit((y - pointer.y) / dt) : 0,
    };
    inputTime = event.timeStamp;
    if (down) travel = Math.max(travel, Math.hypot(x - down.x, y - down.y));
    wake();
  }
  document.addEventListener('pointermove', move, { signal, passive: true });
  svg.addEventListener(
    'pointerdown',
    (event) => {
      if (!allowed() || event.button !== 0 || event.pointerType !== 'mouse')
        return;
      const target = (event.target as Element).closest('[data-world-body]');
      if (!target) return;
      move(event);
      held = Number(target.getAttribute('data-world-body'));
      down = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      travel = 0;
      capture = target;
      pointerId = event.pointerId;
      target.setPointerCapture(event.pointerId);
      svg.dataset.dragging = '';
      event.preventDefault();
      wake();
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      if (held < 0 || event.pointerId !== pointerId) return;
      if (down && travel < 7 && event.timeStamp - down.time < 650)
        disturbWorld(world, held);
      release();
      wake();
    },
    { signal },
  );
  svg.addEventListener(
    'lostpointercapture',
    () => {
      release();
      wake();
    },
    { signal },
  );
  document.addEventListener(
    'pointercancel',
    () => {
      pointer = null;
      release();
      wake();
    },
    { signal },
  );
  document.documentElement.addEventListener(
    'pointerleave',
    () => {
      if (held < 0) pointer = null;
      wake();
    },
    { signal },
  );
  window.addEventListener('blur', reset, { signal });
  window.addEventListener('pagehide', reset, { signal });
  document.addEventListener('visibilitychange', reset, { signal });
  reduced.addEventListener('change', reset, { signal });
  forced.addEventListener('change', reset, { signal });
  return {
    resize,
    reset,
    destroy() {
      destroyed = true;
      reset();
      controller.abort();
      svg.remove();
    },
  };
}
