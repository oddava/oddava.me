import type { NoteGraphData } from './graph';
import { createGraphSimulation, type GraphParticle } from './graph-simulation';

type Camera = { x: number; y: number; scale: number };
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Canvas owns animation and gestures; Preact only owns the surrounding controls. */
export function mountGraph(
  canvas: HTMLCanvasElement,
  data: NoteGraphData,
  currentId: string | undefined,
  onFocus: (id: string | null) => void,
) {
  const ctx = canvas.getContext('2d')!;
  const { nodes, links, simulation } = createGraphSimulation(data, currentId);
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const { source, target } of links) {
    neighbors.get(source.id)!.add(target.id);
    neighbors.get(target.id)!.add(source.id);
  }
  let width = 1,
    height = 1,
    dpr = 1;
  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let targetCamera = { ...camera };
  let cameraEase = 85;
  let lastFrame = 0;
  let reveal = 0;
  let arrival = 1;
  let emphasis = 0;
  let moving = false;
  let panVelocity = { x: 0, y: 0 };
  let panTime = 0;
  const appearance = new Map(
    nodes.map((node) => [node.id, { focus: 0, opacity: 1, label: 0 }]),
  );
  let selected: GraphParticle | undefined;
  let frame = 0,
    visible = true,
    disposed = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let keyboardIndex = Math.max(
    0,
    nodes.findIndex((node) => node.id === currentId),
  );
  let palette = {
    node: '',
    accent: '',
    text: '',
    background: '',
    edge: '',
    font: '',
  };
  let savedCamera: (Camera & { width: number; height: number }) | undefined;
  const labelCache = new Map<string, { title: string; width: number }>();
  const labelOrder = [...nodes].sort(
    (a, b) =>
      Number(b.id === currentId) - Number(a.id === currentId) ||
      b.incoming - a.incoming,
  );
  let expanded = false;
  let manipulated = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture:
    | {
        x: number;
        y: number;
        moved: boolean;
        node?: GraphParticle;
        offsetX?: number;
        offsetY?: number;
      }
    | undefined;
  let pinch: { distance: number; x: number; y: number } | undefined;
  const abort = new AbortController();
  const listen = <K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ) => canvas.addEventListener(type, handler, { signal: abort.signal });

  function readPalette() {
    labelCache.clear();
    const styles = getComputedStyle(canvas);
    const value = (name: string) => styles.getPropertyValue(name).trim();
    palette = {
      node: value('--color-text-secondary'),
      accent: value('--color-brand-strong'),
      text: value('--color-text-secondary'),
      background: value('--color-surface'),
      edge: value('--color-text-disabled'),
      font: styles.fontFamily,
    };
    invalidate();
  }
  function project(node: GraphParticle) {
    return {
      x: camera.x + node.x * camera.scale,
      y: camera.y + node.y * camera.scale,
    };
  }
  function focus(node?: GraphParticle) {
    canvas.style.cursor = gesture?.moved
      ? 'grabbing'
      : node
        ? 'pointer'
        : 'grab';
    if (selected === node) return;
    selected = node;
    onFocus(node?.id ?? null);
    invalidate();
  }
  function invalidate() {
    if (!frame && visible && !disposed) frame = requestAnimationFrame(draw);
  }
  function draw(now: number) {
    frame = 0;
    const elapsed = now - lastFrame;
    const dt = lastFrame && elapsed < 100 ? Math.min(32, elapsed) : 16;
    lastFrame = now;
    moving = false;
    const approach = (
      value: number,
      target: number,
      duration = 90,
      tolerance = 0.002,
    ) => {
      if (reduced || Math.abs(target - value) < tolerance) return target;
      moving = true;
      return value + (target - value) * (1 - Math.exp(-dt / duration));
    };
    reveal = approach(reveal, 1, 70);
    arrival = reduced ? 1 : Math.min(1, arrival + dt / 260);
    if (arrival < 1) moving = true;
    const t = arrival - 1;
    const pop = 0.65 + 0.35 * (1 + 2.7 * t * t * t + 1.7 * t * t);
    emphasis = approach(emphasis, selected ? 1 : 0, selected ? 65 : 110);
    if (
      !gesture &&
      !reduced &&
      Math.hypot(panVelocity.x, panVelocity.y) > 0.015
    ) {
      const decay = Math.exp(-dt / 70);
      camera.x += panVelocity.x * 70 * (1 - decay);
      camera.y += panVelocity.y * 70 * (1 - decay);
      panVelocity.x *= decay;
      panVelocity.y *= decay;
      targetCamera = { ...camera };
      moving = true;
    } else if (!gesture) {
      panVelocity = { x: 0, y: 0 };
      camera.x = approach(camera.x, targetCamera.x, cameraEase);
      camera.y = approach(camera.y, targetCamera.y, cameraEase);
      camera.scale = approach(
        camera.scale,
        targetCamera.scale,
        cameraEase,
        0.00001,
      );
    }
    for (const node of nodes) {
      const state = appearance.get(node.id)!;
      state.focus = approach(
        state.focus,
        node === selected ? 1 : 0,
        node === selected ? 65 : 110,
      );
      const nearby =
        !selected ||
        node === selected ||
        neighbors.get(selected.id)?.has(node.id);
      state.opacity = approach(state.opacity, nearby ? 1 : 0.24, 90);
    }
    // Clear every backing pixel, including the rounded-up edge at fractional
    // display scales; clearing in CSS coordinates can leave a partial-pixel rim.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    // Neutral edges remain one batch; only the focused neighborhood gets color.
    ctx.beginPath();
    for (const { source, target } of links) {
      const a = project(source),
        b = project(target);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = palette.edge;
    ctx.globalAlpha = (0.43 - emphasis * 0.28) * reveal;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    for (const { source, target } of links) {
      const amount = Math.max(
        appearance.get(source.id)!.focus,
        appearance.get(target.id)!.focus,
      );
      if (amount < 0.002) continue;
      const a = project(source),
        b = project(target);
      ctx.globalAlpha = amount * 0.62 * reveal;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const node of nodes) {
      const p = project(node),
        radius =
          node.radius *
          Math.sqrt(camera.scale) *
          (node.id === currentId ? 1.5 : 1) *
          (1 + appearance.get(node.id)!.focus * 0.1) *
          pop;
      if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20)
        continue;
      const state = appearance.get(node.id)!;
      ctx.globalAlpha = state.opacity * reveal;
      ctx.fillStyle = palette.node;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = state.focus * 0.85 * reveal;
      ctx.fillStyle = palette.accent;
      ctx.fill();
    }
    ctx.font = `12px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Screen-space occupancy grid keeps label placement linear, even on large graphs.
    const occupied = new Set<string>();
    const ranked = selected
      ? [selected, ...labelOrder.filter((node) => node !== selected)]
      : labelOrder;
    for (const node of ranked) {
      const primary = node === selected || node.id === currentId;
      let opacity =
        (primary ? 1 : clamp((camera.scale - 0.18) / 0.4, 0, 1)) *
        appearance.get(node.id)!.opacity;
      const p = project(node);
      if (p.x < 8 || p.x > width - 8 || p.y < 8 || p.y > height - 28) continue;
      const maxWidth = Math.min(
        width - 20,
        node === selected || (width > 600 && camera.scale > 0.55) ? 320 : 142,
      );
      const cacheKey = `${node.id}:${maxWidth}`;
      let label = labelCache.get(cacheKey);
      if (!label) {
        let title = node.title;
        while (title.length > 1 && ctx.measureText(title).width > maxWidth)
          title = title.slice(0, -2).trimEnd() + '…';
        label = { title, width: ctx.measureText(title).width };
        labelCache.set(cacheKey, label);
      }
      const { title, width: labelWidth } = label;
      const x = clamp(p.x, labelWidth / 2 + 5, width - labelWidth / 2 - 5);
      const y =
        p.y +
        node.radius *
          Math.sqrt(camera.scale) *
          (node.id === currentId ? 1.5 : 1) +
        7;
      const cells: string[] = [];
      for (
        let cx = Math.floor((x - labelWidth / 2 - 3) / 12);
        cx <= Math.floor((x + labelWidth / 2 + 3) / 12);
        cx++
      ) {
        for (let cy = Math.floor(y / 16); cy <= Math.floor((y + 15) / 16); cy++)
          cells.push(`${cx}:${cy}`);
      }
      if (!primary && cells.some((cell) => occupied.has(cell))) opacity = 0;
      else cells.forEach((cell) => occupied.add(cell));
      const state = appearance.get(node.id)!;
      state.label = approach(state.label, opacity, 70);
      if (state.label < 0.002) continue;
      ctx.globalAlpha = state.label * reveal;
      ctx.strokeStyle = palette.background;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText(title, x, y);
      ctx.fillStyle = palette.text;
      ctx.fillText(title, x, y);
    }
    ctx.globalAlpha = 1;
    if (moving) invalidate();
  }
  function moveCamera(next: Camera, immediate = false) {
    targetCamera = { ...next };
    if (immediate || reduced) camera = { ...next };
    invalidate();
  }
  function stopCamera() {
    targetCamera = { ...camera };
    panVelocity = { x: 0, y: 0 };
  }
  function fit(animate = true) {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x),
      ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = clamp(
      Math.min(
        (width - 64) / Math.max(100, maxX - minX),
        (height - 76) / Math.max(100, maxY - minY),
      ),
      0.08,
      1.8,
    );
    cameraEase = 110;
    moveCamera(
      {
        x: width / 2 - ((minX + maxX) / 2) * scale,
        y: (height - 14) / 2 - ((minY + maxY) / 2) * scale,
        scale,
      },
      !animate,
    );
    manipulated = false;
    invalidate();
  }
  function zoom(factor: number, x = width / 2, y = height / 2, direct = false) {
    const base = direct ? camera : targetCamera;
    const next = clamp(base.scale * factor, 0.08, 5);
    panVelocity = { x: 0, y: 0 };
    cameraEase = 65;
    moveCamera(
      {
        x: x - ((x - base.x) * next) / base.scale,
        y: y - ((y - base.y) * next) / base.scale,
        scale: next,
      },
      direct,
    );
    manipulated = true;
  }
  function point(event: PointerEvent | WheelEvent) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * width) / box.width,
      y: ((event.clientY - box.top) * height) / box.height,
    };
  }
  function hit(p: { x: number; y: number }) {
    let nearest: GraphParticle | undefined,
      distance = Infinity;
    for (const node of nodes) {
      const screen = project(node),
        d = Math.hypot(screen.x - p.x, screen.y - p.y);
      const radius =
        node.radius *
        Math.sqrt(camera.scale) *
        (node.id === currentId ? 1.5 : 1);
      if (d < Math.max(10, radius + 5) && d < distance) {
        nearest = node;
        distance = d;
      }
    }
    return nearest;
  }
  function wake() {
    if (reduced || !nodes.length) return;
    // One small impulse on arrival, resolved by the existing springs/damping.
    // No looping wobble or position reset: the constellation keeps its shape.
    nodes.forEach((node, i) => {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      node.vx = Math.cos(angle) * 1.2;
      node.vy = Math.sin(angle) * 1.2;
    });
    simulation.alpha(0.18).restart();
  }
  function releaseNode() {
    if (gesture?.node) {
      gesture.node.fx = null;
      gesture.node.fy = null;
    }
    simulation.alphaTarget(0);
    if (reduced) simulation.stop();
  }
  listen('pointerdown', (event) => {
    if (event.button !== 0) return;
    stopCamera();
    panTime = performance.now();
    const p = point(event);
    pointers.set(event.pointerId, p);
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    if (pointers.size === 1) {
      const node = hit(p);
      const screen = node ? project(node) : p;
      gesture = {
        ...p,
        moved: false,
        node,
        offsetX: p.x - screen.x,
        offsetY: p.y - screen.y,
      };
      focus(node);
    } else {
      releaseNode();
      if (gesture) gesture.moved = true;
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    }
  });
  listen('pointermove', (event) => {
    const p = point(event),
      previous = pointers.get(event.pointerId);
    if (!previous || !gesture) {
      if (event.pointerType !== 'touch') focus(hit(p));
      return;
    }
    pointers.set(event.pointerId, p);
    if (pointers.size > 1 && pinch) {
      const [a, b] = [...pointers.values()],
        distance = Math.hypot(a.x - b.x, a.y - b.y),
        x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2;
      zoom(distance / Math.max(1, pinch.distance), pinch.x, pinch.y, true);
      camera.x += x - pinch.x;
      camera.y += y - pinch.y;
      targetCamera = { ...camera };
      pinch = { distance, x, y };
      return;
    }
    if (!gesture.moved && Math.hypot(p.x - gesture.x, p.y - gesture.y) < 5)
      return;
    gesture.moved = true;
    manipulated = true;
    canvas.style.cursor = 'grabbing';
    if (gesture.node) {
      gesture.node.fx =
        (p.x - camera.x - (gesture.offsetX ?? 0)) / camera.scale;
      gesture.node.fy =
        (p.y - camera.y - (gesture.offsetY ?? 0)) / camera.scale;
      // The grabbed particle follows the hand exactly; only its neighbors spring.
      gesture.node.x = gesture.node.fx;
      gesture.node.y = gesture.node.fy;
      if (!reduced)
        simulation
          .alphaTarget(0.12)
          .alpha(Math.max(0.12, simulation.alpha()))
          .restart();
    } else {
      const now = performance.now(),
        dt = Math.max(8, now - panTime);
      panVelocity = {
        x: clamp((p.x - previous.x) / dt, -1, 1),
        y: clamp((p.y - previous.y) / dt, -1, 1),
      };
      panTime = now;
      camera.x += p.x - previous.x;
      camera.y += p.y - previous.y;
      targetCamera = { ...camera };
    }
    invalidate();
  });
  function endPointer(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const clicked =
      event.type === 'pointerup' && pointers.size === 1 && !gesture?.moved
        ? gesture?.node
        : undefined;
    if (
      event.type !== 'pointerup' ||
      gesture?.node ||
      performance.now() - panTime > 70 ||
      reduced
    )
      panVelocity = { x: 0, y: 0 };
    // Coast is a small release cue, never a second pan across the sidebar.
    const speed = Math.hypot(panVelocity.x, panVelocity.y);
    const limit = Math.min(28, width * 0.08, height * 0.08) / 70;
    if (speed > limit) {
      panVelocity.x *= limit / speed;
      panVelocity.y *= limit / speed;
    }
    releaseNode();
    pointers.delete(event.pointerId);
    pinch = undefined;
    if (pointers.size) {
      const [p] = pointers.values();
      gesture = { ...p, moved: true };
    } else {
      gesture = undefined;
      focus(event.pointerType === 'touch' ? undefined : hit(point(event)));
    }
    invalidate();
    if (clicked) {
      if (event.ctrlKey || event.metaKey)
        window.open(clicked.href, '_blank', 'noopener');
      else window.location.assign(clicked.href);
    }
  }
  listen('pointerup', endPointer);
  listen('pointercancel', endPointer);
  listen('lostpointercapture', endPointer);
  listen('pointerleave', () => {
    if (!gesture) focus();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const p = point(event);
      zoom(
        Math.exp(
          -clamp(event.deltaY * (event.deltaMode === 1 ? 16 : 1), -120, 120) *
            0.0025,
        ),
        p.x,
        p.y,
      );
    },
    { passive: false, signal: abort.signal },
  );
  listen('keydown', (event) => {
    if (event.key === 'Escape') {
      focus();
      return;
    }
    const distance = event.shiftKey ? 70 : 25;
    if (
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '=',
        '-',
        '0',
        'Home',
        '[',
        ']',
        'Enter',
        'Escape',
      ].includes(event.key)
    )
      event.preventDefault();
    else return;
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key === '0' || event.key === 'Home') {
      stopCamera();
      fit();
    } else if (event.key === 'Enter' && selected)
      window.location.assign(selected.href);
    else if (event.key === 'Escape') focus();
    else if (event.key === '[' || event.key === ']') {
      keyboardIndex =
        (keyboardIndex + (event.key === ']' ? 1 : -1) + nodes.length) %
        nodes.length;
      const node = nodes[keyboardIndex];
      focus(node);
      if (node) {
        const p = project(node);
        if (p.x < 30 || p.x > width - 30 || p.y < 30 || p.y > height - 40) {
          moveCamera({
            ...camera,
            x: width / 2 - node.x * camera.scale,
            y: height / 2 - node.y * camera.scale,
          });
        }
      }
    } else {
      const next = { ...targetCamera };
      if (event.key === 'ArrowLeft') next.x += distance;
      if (event.key === 'ArrowRight') next.x -= distance;
      if (event.key === 'ArrowUp') next.y += distance;
      if (event.key === 'ArrowDown') next.y -= distance;
      panVelocity = { x: 0, y: 0 };
      moveCamera(next);
      manipulated = true;
    }
    invalidate();
  });
  listen('focus', () => focus(nodes[keyboardIndex]));
  listen('blur', () => {
    if (!gesture) focus();
  });
  function resize() {
    const oldWidth = width,
      oldHeight = height;
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (!manipulated) fit(false);
    else {
      camera.x += (width - oldWidth) / 2;
      camera.y += (height - oldHeight) / 2;
      targetCamera.x += (width - oldWidth) / 2;
      targetCamera.y += (height - oldHeight) / 2;
    }
    invalidate();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) {
      if (!reduced && simulation.alpha() > simulation.alphaMin())
        simulation.restart();
      invalidate();
    } else {
      simulation.stop();
      stopCamera();
    }
  });
  visibility.observe(canvas);
  function visibilityChange() {
    if (document.hidden) {
      simulation.stop();
      visible = false;
    } else {
      const rect = canvas.getBoundingClientRect();
      visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (!reduced && visible && simulation.alpha() > simulation.alphaMin())
        simulation.restart();
      invalidate();
    }
  }
  document.addEventListener('visibilitychange', visibilityChange, {
    signal: abort.signal,
  });
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener(
    'change',
    () => {
      reduced = motion.matches;
      if (reduced) {
        simulation.stop();
        stopCamera();
        invalidate();
      }
    },
    { signal: abort.signal },
  );
  const theme = new MutationObserver(readPalette);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  });
  simulation.on('tick', invalidate);
  simulation.on('end', () => {
    if (!manipulated) fit();
  });
  if (reduced) simulation.tick(120);
  else wake();
  readPalette();
  resize();
  void document.fonts.ready.then(() => {
    if (!disposed) readPalette();
  });
  return {
    arrive() {
      arrival = reduced ? 1 : 0;
      wake();
      invalidate();
    },
    fit,
    zoom,
    expand(value: boolean) {
      if (expanded === value) return;
      stopCamera();
      expanded = value;
      if (value) {
        savedCamera = { ...camera, width, height };
        resize();
        fit(false);
        wake();
      } else {
        resize();
        if (savedCamera) {
          camera = {
            scale: savedCamera.scale,
            x: savedCamera.x + (width - savedCamera.width) / 2,
            y: savedCamera.y + (height - savedCamera.height) / 2,
          };
          targetCamera = { ...camera };
          manipulated = true;
        }
        invalidate();
      }
    },
    select(id: string) {
      focus(nodes.find((node) => node.id === id));
      invalidate();
    },
    destroy() {
      disposed = true;
      abort.abort();
      simulation.stop();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
    },
  };
}
