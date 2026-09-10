import { type FolioView } from './geometry';
import { FolioSheet, type Contact } from './physics';

const mounted = new WeakMap<HTMLElement, () => void>();

/** Owns one small canvas, one RAF, and abortable input listeners. No GPU,
 * assets, timers, tracking, or work while the document is hidden. */
export function mountFolio(root: HTMLElement): (() => void) | null {
  mounted.get(root)?.();
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  const context = canvas?.getContext('2d', { alpha: true });
  if (!canvas || !context) return null;

  const controller = new AbortController();
  const { signal } = controller;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = matchMedia('(forced-colors: active)');
  let paused = motion.matches;
  let destroyed = false;
  let frame = 0;
  let last = 0;
  const seed = Math.random() * 3;
  let time = 0;
  let sheet: FolioSheet | undefined;
  let elasticActive = false;
  const contacts = new Map<number, Contact>();
  let ink = '';
  let edge = '';
  let view: FolioView = {
    width: 1,
    height: 1,
    centerX: 0,
    centerY: 0,
    quietWidth: 0,
    quietHeight: 0,
  };

  function palette() {
    const style = getComputedStyle(root);
    ink = style.getPropertyValue('--folio-ink').trim();
    edge = style.getPropertyValue('--folio-edge').trim();
  }

  function draw() {
    if (destroyed || contrast.matches || document.hidden) return;
    const { width, height } = view;
    context!.clearRect(0, 0, width, height);
    if (!sheet) return;
    const count = sheet.lines;
    const steps = sheet.points;
    for (let line = 0; line < count; line++) {
      const layer = line / (count - 1);
      const keyline = line % 12 === 0;
      context!.strokeStyle = keyline ? edge : ink;
      context!.lineWidth = keyline ? 0.85 : 0.6;
      context!.globalAlpha = keyline
        ? 0.36
        : 0.14 + Math.sin(layer * Math.PI) * 0.12;
      context!.beginPath();
      for (let step = 0; step <= steps; step++) {
        const [x, y] = sheet.point(line, step);
        if (step === 0) context!.moveTo(x, y);
        else context!.lineTo(x, y);
      }
      context!.stroke();
    }

    context!.globalAlpha = 1;
    root.dataset.ready = '';
  }

  function animate(now: number) {
    frame = 0;
    if (destroyed || paused || document.hidden || contrast.matches) return;
    const elapsed = now - last;
    if (elapsed >= 1000 / 60 - 0.5) {
      last = now;
      const dt = Math.min(elapsed / 1000, 0.05);
      time += dt;
      // The slow folds keep moving beneath the independent touch deformation.
      sheet?.reshape(view, seed, false, time);
      if (sheet && (elasticActive || contacts.size)) {
        elasticActive = sheet.step(dt, contacts.values());
      }
      for (const contact of contacts.values()) {
        contact.dx *= 0.7;
        contact.dy *= 0.7;
      }
      draw();
    }
    frame = requestAnimationFrame(animate);
  }

  function start() {
    if (
      !frame &&
      !destroyed &&
      !paused &&
      !document.hidden &&
      !contrast.matches
    ) {
      last = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function resize() {
    if (destroyed) return;
    const bounds = canvas!.getBoundingClientRect();
    const parts = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.home-hero__name, .home-hero__tagline, .home-hero__cta',
      ),
    ).map((part) => part.getBoundingClientRect());
    const left = parts.length
      ? Math.min(...parts.map((part) => part.left))
      : bounds.width * 0.3;
    const right = parts.length
      ? Math.max(...parts.map((part) => part.right))
      : bounds.width * 0.7;
    const top = parts.length
      ? Math.min(...parts.map((part) => part.top))
      : bounds.height * 0.35;
    const bottom = parts.length
      ? Math.max(...parts.map((part) => part.bottom))
      : bounds.height * 0.65;
    view = {
      width: bounds.width,
      height: bounds.height,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
      quietWidth: right - left + 24,
      quietHeight: bottom - top + 24,
    };
    // Bound backing-store memory on high-density and very large displays.
    const dpr = Math.min(
      devicePixelRatio || 1,
      1.75,
      Math.sqrt(5_000_000 / Math.max(1, bounds.width * bounds.height)),
    );
    canvas!.width = Math.round(bounds.width * dpr);
    canvas!.height = Math.round(bounds.height * dpr);
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lines = bounds.width < 640 ? 36 : 56;
    if (!sheet || sheet.lines !== lines)
      sheet = new FolioSheet(lines, 128, view, seed);
    else sheet.reshape(view, seed, false, time);
    draw();
  }

  function syncPause() {
    root.dataset.motion = paused ? 'still' : 'playing';
    if (paused) {
      stop();
      contacts.clear();
      draw();
    } else start();
  }

  const interactive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      'a, button, input, textarea, select, [contenteditable], [role=button], .spotify-widget-positioner, .home-hero__name, .home-hero__tagline, .home-hero__cta',
    );

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        paused ||
        event.button !== 0 ||
        interactive(event.target) ||
        contacts.size >= 5
      )
        return;
      const contact: Contact = {
        x: event.clientX,
        y: event.clientY,
        dx: 0,
        dy: 0,
        pressure: event.pressure || 0.5,
        twist: (Math.random() - 0.5) * 1.5,
      };
      contacts.set(event.pointerId, contact);
      sheet?.pluck(contact);
      elasticActive = true;
      if (
        event.target instanceof Element &&
        'setPointerCapture' in event.target
      ) {
        event.target.setPointerCapture(event.pointerId);
      }
      start();
    },
    { signal, passive: true },
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (paused) return;
      const contact = contacts.get(event.pointerId);
      if (contact) {
        contact.dx = Math.max(-35, Math.min(35, event.clientX - contact.x));
        contact.dy = Math.max(-35, Math.min(35, event.clientY - contact.y));
        contact.x = event.clientX;
        contact.y = event.clientY;
        contact.pressure = event.pressure || 0.5;
        start();
      } else if (event.pointerType === 'mouse' && !interactive(event.target)) {
        elasticActive = true;
        // Hover gives a light, local brush; dragging applies sustained force.
        sheet?.pluck({
          x: event.clientX,
          y: event.clientY,
          dx: 0,
          dy: 0,
          pressure: -0.65,
          twist: 0,
        });
        start();
      }
    },
    { signal, passive: true },
  );
  const endContact = (event: PointerEvent) => {
    contacts.delete(event.pointerId);
  };
  document.addEventListener('pointerup', endContact, { signal, passive: true });
  document.addEventListener('pointercancel', endContact, {
    signal,
    passive: true,
  });
  document.addEventListener('lostpointercapture', endContact, { signal });
  const release = () => {
    contacts.clear();
  };
  window.addEventListener('blur', release, { signal });
  motion.addEventListener(
    'change',
    () => {
      paused = motion.matches;
      syncPause();
    },
    { signal },
  );
  contrast.addEventListener(
    'change',
    () => {
      stop();
      resize();
      start();
    },
    { signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        stop();
        release();
      } else {
        draw();
        start();
      }
    },
    { signal },
  );
  window.addEventListener('pagehide', stop, { signal });
  window.addEventListener(
    'pageshow',
    () => {
      resize();
      start();
    },
    { signal },
  );
  window.addEventListener('resize', resize, { signal, passive: true });
  window.addEventListener('scroll', resize, { signal, passive: true });
  const observer = new ResizeObserver(resize);
  const hero = document.querySelector('.home-hero');
  if (hero) observer.observe(hero);
  const themeObserver = new MutationObserver(() => {
    palette();
    draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  const destroy = () => {
    destroyed = true;
    stop();
    controller.abort();
    observer.disconnect();
    themeObserver.disconnect();
    mounted.delete(root);
  };
  document.addEventListener('astro:before-swap', destroy, {
    signal,
    once: true,
  });
  palette();
  resize();
  syncPause();
  void document.fonts.ready.then(() => {
    if (!destroyed) resize();
  });
  mounted.set(root, destroy);
  return destroy;
}
