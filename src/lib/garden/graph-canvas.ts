import type { NoteGraphData } from './graph';
import type { GraphFrame } from './graph-transition-frame';
import {
  createGraphSimulation,
  startGraphFormation,
  type GraphParticle,
} from './graph-simulation';

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
  const particlesById = new Map(nodes.map((node) => [node.id, node]));
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
  let suspended = false;
  let formation:
    | {
        started: number;
        released: boolean;
        pausedAt?: number;
        physics: ReturnType<typeof startGraphFormation>;
      }
    | undefined;
  let settlement:
    | {
        started: number;
        ticks: number;
        scale: number;
        origins: Map<string, { x: number; y: number }>;
      }
    | undefined;
  let painted: GraphFrame | undefined;
  let paintedCamera = { ...camera };
  const projections = new WeakMap<
    GraphFrame,
    {
      camera: Camera;
      points: Map<string, GraphFrame['nodes'][number]>;
      offsets: { x: number; y: number }[];
    }
  >();
  let reveal = 0;
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
  ) =>
    canvas.addEventListener(
      type,
      (event) => {
        if (!suspended) handler(event);
      },
      { signal: abort.signal },
    );

  function readPalette() {
    labelCache.clear();
    const styles = getComputedStyle(canvas);
    const value = (name: string) => styles.getPropertyValue(name).trim();
    palette = {
      node: value('--color-text-muted'),
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
    if (!frame && visible && !disposed && !suspended)
      frame = requestAnimationFrame(draw);
  }
  function draw(now: number, still = false) {
    frame = 0;
    const elapsed = now - lastFrame;
    const dt = lastFrame && elapsed < 100 ? Math.min(32, elapsed) : 16;
    lastFrame = now;
    moving = false;
    if (!still) {
      advanceSettlement(now);
      advanceFormation(now);
    }
    const captured: GraphFrame = {
      width,
      height,
      nodes: [],
      edges: [],
      labels: [],
    };
    const approach = (
      value: number,
      target: number,
      duration = 90,
      tolerance = 0.002,
    ) => {
      if (still) return value;
      if (reduced || Math.abs(target - value) < tolerance) return target;
      moving = true;
      return value + (target - value) * (1 - Math.exp(-dt / duration));
    };
    reveal = approach(reveal, 1, 70);
    emphasis = approach(emphasis, selected ? 1 : 0, selected ? 65 : 110);
    if (
      !still &&
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
      captured.edges.push({
        source: source.id,
        target: target.id,
        color: palette.edge,
        opacity: (0.43 - emphasis * 0.28) * reveal,
        accent: palette.accent,
        focus:
          Math.max(
            appearance.get(source.id)!.focus,
            appearance.get(target.id)!.focus,
          ) *
          0.62 *
          reveal,
      });
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
          (1 + appearance.get(node.id)!.focus * 0.1);
      const state = appearance.get(node.id)!;
      captured.nodes.push({
        id: node.id,
        x: p.x,
        y: p.y,
        radius,
        color: node.id === currentId ? palette.accent : palette.node,
        opacity: state.opacity * reveal,
        focus: state.focus * 0.85 * reveal,
        accent: palette.accent,
        hole: node.id === currentId ? palette.background : undefined,
      });
      if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20)
        continue;
      ctx.globalAlpha = state.opacity * reveal;
      ctx.fillStyle = node.id === currentId ? palette.accent : palette.node;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = state.focus * 0.85 * reveal;
      ctx.fillStyle = palette.accent;
      ctx.fill();
      if (node.id === currentId) {
        // An open blue seed marks this note, echoing the site's link accent.
        ctx.globalAlpha = state.opacity * reveal;
        ctx.fillStyle = palette.background;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
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
      ctx.fillStyle = node.id === currentId ? palette.accent : palette.text;
      ctx.fillText(title, x, y);
      captured.labels.push({
        id: node.id,
        title,
        x,
        y,
        color: node.id === currentId ? palette.accent : palette.text,
        background: palette.background,
        opacity: state.label * reveal,
        font: ctx.font,
      });
    }
    ctx.globalAlpha = 1;
    painted = captured;
    paintedCamera = { ...camera };
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
    stopSettlement();
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
    stopSettlement();
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
  function stopFormation() {
    formation?.physics.stop();
    formation = undefined;
  }
  function startFormation() {
    stopSettlement();
    stopFormation();
    if (reduced || disposed || !nodes.length) return;
    formation = {
      started: performance.now(),
      released: false,
      physics: startGraphFormation(nodes, links, simulation, 14 / camera.scale),
    };
  }
  function pauseFormation(value: boolean) {
    if (!formation) return;
    if (value) formation.pausedAt ??= performance.now();
    else if (formation.pausedAt !== undefined) {
      formation.started += performance.now() - formation.pausedAt;
      formation.pausedAt = undefined;
    }
  }
  function advanceFormation(now: number, snapshot?: GraphFrame, aperture = 1) {
    if (!formation || formation.pausedAt !== undefined) return;
    if (!formation.released) {
      // Release the compressed network once there is room to see its forces.
      // Geometry drives this threshold (~95ms), not a separate delayed timer.
      if (aperture < 0.9) return;
      formation.released = true;
      formation.started = now;
    }
    formation.physics.advance(now - formation.started);
    if (snapshot) {
      const projection = projections.get(snapshot);
      const view = projection?.camera ?? camera;
      for (const point of snapshot.nodes) {
        const node = particlesById.get(point.id);
        if (!node) continue;
        point.x = view.x + node.x * view.scale;
        point.y = view.y + node.y * view.scale;
      }
      if (projection)
        snapshot.labels.forEach((label, i) => {
          const point = projection.points.get(label.id);
          if (point) {
            label.x = point.x + projection.offsets[i].x;
            label.y = point.y + projection.offsets[i].y;
          }
        });
      delete snapshot.bitmap;
    }
    if (!formation.physics.active) formation = undefined;
    else moving = true;
  }
  function stopSettlement() {
    stopFormation();
    if (!settlement) return;
    settlement = undefined;
    simulation.stop().alpha(0);
    for (const node of nodes) node.vx = node.vy = 0;
  }
  function settle(momentum: ReadonlyMap<string, { x: number; y: number }>) {
    if (disposed || suspended || reduced || !nodes.length || document.hidden)
      return;
    const rect = canvas.getBoundingClientRect();
    if (
      !canvas.isConnected ||
      !rect.width ||
      !rect.height ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight
    )
      return;
    stopSettlement();
    simulation.stop().alphaTarget(0).alpha(0);
    let hasMomentum = false;
    // Convert each arriving node's screen velocity to D3's per-tick velocity.
    // The first tick applies existing damping; handoff never moves positions.
    const conversion =
      1 / (60 * (1 - simulation.velocityDecay()) * camera.scale);
    for (const node of nodes) {
      node.vx = node.vy = 0;
      const velocity = momentum.get(node.id);
      if (
        !velocity ||
        !Number.isFinite(velocity.x) ||
        !Number.isFinite(velocity.y)
      )
        continue;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed < 0.5) continue;
      const limit = Math.min(1, 60 / speed);
      node.vx = velocity.x * conversion * limit;
      node.vy = velocity.y * conversion * limit;
      hasMomentum = true;
    }
    if (!hasMomentum) return;
    settlement = {
      started: performance.now(),
      ticks: 0,
      scale: camera.scale,
      origins: new Map(
        nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      ),
    };
    // The existing paint loop advances this release at 60 physics ticks/sec,
    // so a 120Hz display does not double its speed or halve its lifetime.
    simulation.alpha(
      simulation.alphaMin() / Math.pow(1 - simulation.alphaDecay(), 15),
    );
    invalidate();
  }
  function advanceSettlement(now: number) {
    if (!settlement) return;
    const elapsed = Math.max(0, now - settlement.started);
    const due = Math.min(15, Math.floor((elapsed * 60) / 1000));
    // At most three catch-up ticks after a delayed frame; the 250ms wall-clock
    // budget still wins, so a stalled tab cannot replay old landing motion.
    const count = Math.min(3, due - settlement.ticks);
    if (count > 0) {
      simulation.tick(count);
      settlement.ticks += count;
      const limit = 3 / settlement.scale;
      for (const node of nodes) {
        const origin = settlement.origins.get(node.id)!;
        const dx = node.x - origin.x,
          dy = node.y - origin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > limit) {
          node.x = origin.x + (dx * limit) / distance;
          node.y = origin.y + (dy * limit) / distance;
          node.vx = node.vy = 0;
        }
      }
    }
    if (elapsed >= 250) stopSettlement();
    else moving = true;
  }
  function wake() {
    if (reduced || suspended || !nodes.length) return;
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
    stopSettlement();
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
      if (!reduced && !suspended)
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
      if (suspended) return;
      stopSettlement();
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
    stopSettlement();
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
  function resize(force = false) {
    if (suspended && !force) return;
    const nextWidth = Math.max(1, canvas.clientWidth);
    const nextHeight = Math.max(1, canvas.clientHeight);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      width === nextWidth &&
      height === nextHeight &&
      dpr === nextDpr &&
      canvas.width === Math.round(width * dpr) &&
      canvas.height === Math.round(height * dpr)
    )
      return;
    if (!formation) stopSettlement();
    const oldWidth = width,
      oldHeight = height;
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr))
      canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr))
      canvas.height = Math.round(height * dpr);
    if (!manipulated && !formation) fit(false);
    else {
      camera.x += (width - oldWidth) / 2;
      camera.y += (height - oldHeight) / 2;
      targetCamera.x += (width - oldWidth) / 2;
      targetCamera.y += (height - oldHeight) / 2;
    }
    invalidate();
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) {
      if (
        !reduced &&
        !suspended &&
        !settlement &&
        !formation &&
        simulation.alpha() > simulation.alphaMin()
      )
        simulation.restart();
      invalidate();
    } else {
      stopSettlement();
      simulation.stop();
      stopCamera();
    }
  });
  visibility.observe(canvas);
  function visibilityChange() {
    if (document.hidden) {
      stopSettlement();
      simulation.stop();
      visible = false;
    } else {
      const rect = canvas.getBoundingClientRect();
      visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (
        !reduced &&
        !suspended &&
        !settlement &&
        !formation &&
        visible &&
        simulation.alpha() > simulation.alphaMin()
      )
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
        stopSettlement();
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
  function paint() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = 0;
    reveal = 1;
    draw(performance.now(), suspended);
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function capture(): GraphFrame {
    if (!painted) paint();
    const captured = { ...painted! };
    const points = new Map(captured.nodes.map((point) => [point.id, point]));
    projections.set(captured, {
      camera: { ...paintedCamera },
      points,
      offsets: captured.labels.map((label) => {
        const point = points.get(label.id)!;
        return { x: label.x - point.x, y: label.y - point.y };
      }),
    });
    if (captured.width === width && captured.height === height) {
      const bitmap = document.createElement('canvas');
      bitmap.width = canvas.width;
      bitmap.height = canvas.height;
      bitmap.getContext('2d')?.drawImage(canvas, 0, 0);
      captured.bitmap = bitmap;
    }
    return captured;
  }
  function captureAt(
    nextWidth: number,
    nextHeight: number,
    mini = false,
  ): GraphFrame {
    const previous = {
      width,
      height,
      camera,
      targetCamera,
      painted,
      lastFrame,
      manipulated,
    };
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    if (mini && savedCamera) {
      camera = {
        scale: savedCamera.scale,
        x: savedCamera.x + (width - savedCamera.width) / 2,
        y: savedCamera.y + (height - savedCamera.height) / 2,
      };
    } else if (manipulated || formation) {
      camera = {
        ...camera,
        x: camera.x + (width - previous.width) / 2,
        y: camera.y + (height - previous.height) / 2,
      };
    } else {
      fit(false);
    }
    targetCamera = { ...camera };
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw(performance.now(), true);
    const result = capture();
    ({ width, height, camera, targetCamera, painted, lastFrame, manipulated } =
      previous);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw(performance.now(), true);
    cancelAnimationFrame(frame);
    frame = 0;
    return result;
  }
  return {
    startFormation,
    stopFormation,
    pauseFormation,
    advanceFormation,
    formationActive: () => !!formation,
    settle,
    paint,
    capture,
    captureAt,
    captureMini: (width: number, height: number) =>
      captureAt(width, height, true),
    resize() {
      resize(true);
    },
    suspend(value: boolean) {
      suspended = value;
      if (value) {
        stopSettlement();
        releaseNode();
        gesture = undefined;
        pinch = undefined;
        for (const pointerId of pointers.keys()) {
          if (canvas.hasPointerCapture(pointerId))
            canvas.releasePointerCapture(pointerId);
        }
        pointers.clear();
        simulation.stop();
        cancelAnimationFrame(frame);
        frame = 0;
        stopCamera();
      } else {
        suspended = true;
        resize(true);
        paint();
        suspended = false;
        lastFrame = 0;
        if (
          !reduced &&
          !settlement &&
          !formation &&
          visible &&
          simulation.alpha() > simulation.alphaMin()
        )
          simulation.restart();
        invalidate();
      }
    },
    fit,
    zoom,
    expand(value: boolean) {
      if (expanded === value) {
        resize(true);
        return;
      }
      stopCamera();
      expanded = value;
      if (value) {
        savedCamera = { ...camera, width, height };
        resize(true);
        fit(false);
        wake();
      } else {
        resize(true);
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
      stopSettlement();
      abort.abort();
      simulation.stop();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
    },
  };
}
