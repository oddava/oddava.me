import type { NoteGraphData } from './graph';
import { bloomPoint, bloomProgress } from './graph-bloom';
import { createGraphSimulation, warmUp } from './graph-simulation';

type Camera = { x: number; y: number; scale: number };
type Label = { title: string; width: number };
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
// Label occupancy cells, in CSS pixels.
const CELL_W = 12,
  CELL_H = 16;

/** Canvas owns animation and gestures; Preact only owns the surrounding controls. */
export function mountGraph(
  canvas: HTMLCanvasElement,
  data: NoteGraphData,
  currentId: string | undefined,
  onFocus: (id: string | null) => void,
) {
  const ctx = canvas.getContext('2d')!;
  const { nodes, links, simulation } = createGraphSimulation(data, currentId);
  const count = nodes.length;
  // Everything per node lives in arrays indexed like `nodes`, so a frame
  // allocates nothing however large the graph is.
  const indexOf = new Map(nodes.map((node, i) => [node, i]));
  const edgeA = Int32Array.from(links, (link) => indexOf.get(link.source)!);
  const edgeB = Int32Array.from(links, (link) => indexOf.get(link.target)!);
  const neighbors = nodes.map(() => new Set<number>());
  for (let e = 0; e < links.length; e++) {
    neighbors[edgeA[e]!]!.add(edgeB[e]!);
    neighbors[edgeB[e]!]!.add(edgeA[e]!);
  }
  const current = nodes.findIndex((node) => node.id === currentId);
  const sx = new Float64Array(count),
    sy = new Float64Array(count);
  const focusOf = new Float32Array(count),
    opacityOf = new Float32Array(count).fill(1),
    labelOf = new Float32Array(count);
  const labelOrder = Int32Array.from(nodes.keys()).sort(
    (a, b) =>
      Number(b === current) - Number(a === current) ||
      nodes[b]!.incoming - nodes[a]!.incoming,
  );
  // Measured, truncated titles per label width; cleared when the font changes.
  const labelCache = new Map<number, (Label | undefined)[]>();
  let occupied = new Uint8Array(0),
    columns = 0,
    rows = 0;
  let width = 1,
    height = 1,
    dpr = 1;
  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let targetCamera = { ...camera };
  let cameraEase = 85;
  let lastFrame = 0;
  // Presented positions while blooming; at rest nodes draw where they are laid out.
  let bloom:
    { started: number; x: number; y: number; reach: Float32Array } | undefined;
  const bloomX = new Float64Array(count),
    bloomY = new Float64Array(count),
    bloomAlpha = new Float32Array(count);
  const bloomScratch = { x: 0, y: 0, alpha: 0 };
  let bloomEdges = 1,
    bloomLabels = 1;
  // Physics runs inside the paint loop rather than on d3's own timer: one
  // frame callback ticks, then draws, so a frame never shows a stale layout.
  let physics = false;
  let reveal = 0;
  let emphasis = 0;
  let moving = false;
  let panVelocity = { x: 0, y: 0 };
  let panTime = 0;
  let selected = -1;
  let frame = 0,
    visible = true,
    disposed = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let keyboardIndex = Math.max(0, current);
  let palette = {
    node: '',
    accent: '',
    text: '',
    background: '',
    edge: '',
    font: '',
  };
  let savedCamera: (Camera & { width: number; height: number }) | undefined;
  let expanded = false;
  let manipulated = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture:
    | {
        x: number;
        y: number;
        moved: boolean;
        node: number;
        offsetX: number;
        offsetY: number;
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
      node: value('--color-text-muted'),
      accent: value('--color-brand-strong'),
      text: value('--color-text-secondary'),
      background: value('--color-surface'),
      edge: value('--color-text-disabled'),
      font: styles.fontFamily,
    };
    invalidate();
  }
  function screenX(i: number) {
    return camera.x + (bloom ? bloomX[i]! : nodes[i]!.x) * camera.scale;
  }
  function screenY(i: number) {
    return camera.y + (bloom ? bloomY[i]! : nodes[i]!.y) * camera.scale;
  }
  function radiusOf(i: number) {
    return (
      nodes[i]!.radius * Math.sqrt(camera.scale) * (i === current ? 1.5 : 1)
    );
  }
  function focus(i: number) {
    canvas.style.cursor = gesture?.moved
      ? 'grabbing'
      : i >= 0
        ? 'pointer'
        : 'grab';
    if (selected === i) return;
    selected = i;
    onFocus(i >= 0 ? nodes[i]!.id : null);
    invalidate();
  }
  function invalidate() {
    if (!frame && visible && !disposed) frame = requestAnimationFrame(draw);
  }
  /** Paint before the browser can show a canvas that a resize just cleared. */
  function paintNow(still: true | 'settled' = true) {
    cancelAnimationFrame(frame);
    frame = 0;
    draw(performance.now(), still);
    invalidate();
  }
  function measure(i: number, maxWidth: number) {
    let cache = labelCache.get(maxWidth);
    if (!cache) labelCache.set(maxWidth, (cache = []));
    let label = cache[i];
    if (!label) {
      let title = nodes[i]!.title;
      while (title.length > 1 && ctx.measureText(title).width > maxWidth)
        title = title.slice(0, -2).trimEnd() + '…';
      label = cache[i] = { title, width: ctx.measureText(title).width };
    }
    return label;
  }
  /** `still` freezes fades where they are; `settled` lands them on their targets. */
  function draw(now: number, still: boolean | 'settled' = false) {
    frame = 0;
    const elapsed = now - lastFrame;
    const dt = lastFrame && elapsed < 100 ? Math.min(32, elapsed) : 16;
    lastFrame = now;
    moving = false;
    if (!still) {
      stepPhysics();
      advanceBloom(now);
    }
    const approach = (
      value: number,
      target: number,
      duration = 90,
      tolerance = 0.002,
    ) => {
      if (still === true) return value;
      if (still) return target;
      if (reduced || Math.abs(target - value) < tolerance) return target;
      moving = true;
      return value + (target - value) * (1 - Math.exp(-dt / duration));
    };
    reveal = approach(reveal, 1, 70);
    emphasis = approach(
      emphasis,
      selected >= 0 ? 1 : 0,
      selected >= 0 ? 65 : 110,
    );
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
    const near = selected >= 0 ? neighbors[selected]! : undefined;
    for (let i = 0; i < count; i++) {
      const on = i === selected;
      focusOf[i] = approach(focusOf[i]!, on ? 1 : 0, on ? 65 : 110);
      const nearby = !near || on || near.has(i);
      opacityOf[i] = approach(opacityOf[i]!, nearby ? 1 : 0.24, 90);
      sx[i] = screenX(i);
      sy[i] = screenY(i);
    }
    // Clear every backing pixel, including the rounded-up edge at fractional
    // display scales; clearing in CSS coordinates can leave a partial-pixel rim.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    // Neutral edges are one batched stroke; edges wholly beside the viewport
    // never reach the path. Only the focused neighborhood gets color.
    ctx.beginPath();
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e]!,
        b = edgeB[e]!;
      const ax = sx[a]!,
        ay = sy[a]!,
        bx = sx[b]!,
        by = sy[b]!;
      if (
        (ax < 0 && bx < 0) ||
        (ay < 0 && by < 0) ||
        (ax > width && bx > width) ||
        (ay > height && by > height)
      )
        continue;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = palette.edge;
    ctx.globalAlpha = (0.43 - emphasis * 0.28) * reveal * bloomEdges;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e]!,
        b = edgeB[e]!;
      const amount = Math.max(focusOf[a]!, focusOf[b]!);
      if (amount < 0.002) continue;
      ctx.globalAlpha = amount * 0.62 * reveal * bloomEdges;
      ctx.beginPath();
      ctx.moveTo(sx[a]!, sy[a]!);
      ctx.lineTo(sx[b]!, sy[b]!);
      ctx.stroke();
    }
    for (let i = 0; i < count; i++) {
      const x = sx[i]!,
        y = sy[i]!;
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const radius = radiusOf(i) * (1 + focusOf[i]! * 0.1);
      const presence = reveal * (bloom ? bloomAlpha[i]! : 1);
      ctx.globalAlpha = opacityOf[i]! * presence;
      ctx.fillStyle = i === current ? palette.accent : palette.node;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = focusOf[i]! * 0.85 * presence;
      ctx.fillStyle = palette.accent;
      ctx.fill();
      if (i === current) {
        // An open blue seed marks this note, echoing the site's link accent.
        ctx.globalAlpha = opacityOf[i]! * presence;
        ctx.fillStyle = palette.background;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.font = `12px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.background;
    // A screen-space occupancy grid keeps label placement linear in node count.
    occupied.fill(0);
    const zoomFade = clamp((camera.scale - 0.18) / 0.4, 0, 1);
    const wide = width > 600 && camera.scale > 0.55;
    const label = (i: number) => {
      const primary = i === selected || i === current;
      const target = (primary ? 1 : zoomFade) * opacityOf[i]!;
      // Hidden and staying hidden: never measured, never placed.
      if (target === 0 && labelOf[i]! < 0.002) {
        labelOf[i] = 0;
        return;
      }
      const px = sx[i]!,
        py = sy[i]!;
      if (px < 8 || px > width - 8 || py < 8 || py > height - 28) return;
      const { title, width: labelWidth } = measure(
        i,
        Math.min(width - 20, i === selected || wide ? 320 : 142),
      );
      const x = clamp(px, labelWidth / 2 + 5, width - labelWidth / 2 - 5);
      const y = py + radiusOf(i) + 7;
      const c0 = clamp(
        Math.floor((x - labelWidth / 2 - 3) / CELL_W),
        0,
        columns - 1,
      );
      const c1 = clamp(
        Math.floor((x + labelWidth / 2 + 3) / CELL_W),
        0,
        columns - 1,
      );
      const r0 = clamp(Math.floor(y / CELL_H), 0, rows - 1);
      const r1 = clamp(Math.floor((y + 15) / CELL_H), 0, rows - 1);
      let free = true;
      if (!primary)
        for (let r = r0; free && r <= r1; r++)
          for (let c = c0; c <= c1; c++)
            if (occupied[r * columns + c]) {
              free = false;
              break;
            }
      // Only a label that is showing claims space; one fading out yields it.
      if (free && target > 0)
        for (let r = r0; r <= r1; r++)
          occupied.fill(1, r * columns + c0, r * columns + c1 + 1);
      labelOf[i] = approach(labelOf[i]!, free ? target : 0, 70);
      if (labelOf[i]! < 0.002) return;
      ctx.globalAlpha = labelOf[i]! * reveal * bloomLabels;
      ctx.strokeText(title, x, y);
      ctx.fillStyle = i === current ? palette.accent : palette.text;
      ctx.fillText(title, x, y);
    };
    if (selected >= 0) label(selected);
    for (const i of labelOrder) if (i !== selected) label(i);
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
  function bounds() {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    return { minX, maxX, minY, maxY };
  }
  function fit(animate = true) {
    if (!count) return;
    const { minX, maxX, minY, maxY } = bounds();
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
    stopBloom();
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
    let nearest = -1,
      distance = Infinity;
    for (let i = 0; i < count; i++) {
      const d = Math.hypot(screenX(i) - p.x, screenY(i) - p.y);
      if (d < Math.max(10, radiusOf(i) + 5) && d < distance) {
        nearest = i;
        distance = d;
      }
    }
    return nearest;
  }
  function startPhysics() {
    if (reduced || disposed) return;
    physics = true;
    invalidate();
  }
  function stopPhysics() {
    physics = false;
  }
  function stepPhysics() {
    if (!physics) return;
    // Under cover of a bloom, cooling may fast-forward within a small frame
    // budget, so mid-size graphs land with it instead of drifting for seconds.
    // Otherwise — and always while a note is held — one tick per frame keeps
    // the springs' feel.
    const free = !!bloom && simulation.alphaTarget() === 0;
    const deadline = performance.now() + 4;
    let ticks = 0;
    do {
      simulation.tick();
      ticks++;
    } while (
      free &&
      ticks < 24 &&
      simulation.alpha() >= simulation.alphaMin() &&
      performance.now() < deadline
    );
    if (
      simulation.alphaTarget() === 0 &&
      simulation.alpha() < simulation.alphaMin()
    )
      physics = false;
    // While the layout cools on its own the camera keeps it framed, easing
    // every frame rather than jumping once at the end. Once anyone moves the
    // camera or a note, the view is theirs.
    if (!manipulated) fit();
    moving = true;
  }
  function startBloom() {
    if (reduced || disposed || !count) return;
    // Unfurl from the current note when there is one, else from the layout's centre.
    const seed = nodes[current];
    const { minX, maxX, minY, maxY } = bounds();
    const x = seed?.x ?? (minX + maxX) / 2;
    const y = seed?.y ?? (minY + maxY) / 2;
    const reach = Float32Array.from(nodes, (n) => Math.hypot(n.x - x, n.y - y));
    const farthest = Math.max(1, ...reach);
    for (let i = 0; i < count; i++) reach[i]! /= farthest;
    bloom = { started: performance.now(), x, y, reach };
    advanceBloom(bloom.started);
    paintNow();
  }
  function advanceBloom(now: number) {
    if (!bloom) return;
    const elapsed = now - bloom.started;
    const progress = bloomProgress(elapsed);
    if (progress.done) {
      stopBloom();
      return;
    }
    // Relative to the live layout, so a still-cooling simulation stays smooth.
    for (let i = 0; i < count; i++) {
      const node = nodes[i]!;
      bloomPoint(
        node.x,
        node.y,
        bloom.x,
        bloom.y,
        bloom.reach[i]!,
        elapsed,
        bloomScratch,
      );
      bloomX[i] = bloomScratch.x;
      bloomY[i] = bloomScratch.y;
      bloomAlpha[i] = bloomScratch.alpha;
    }
    bloomEdges = progress.edges;
    bloomLabels = progress.labels;
    moving = true;
  }
  function stopBloom() {
    if (!bloom) return;
    bloom = undefined;
    bloomEdges = bloomLabels = 1;
    invalidate();
  }
  function releaseNode() {
    if (gesture && gesture.node >= 0) {
      nodes[gesture.node]!.fx = null;
      nodes[gesture.node]!.fy = null;
    }
    simulation.alphaTarget(0);
    if (reduced) stopPhysics();
  }
  listen('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Direct manipulation lands the bloom; the hand always meets the real layout.
    stopBloom();
    stopCamera();
    panTime = performance.now();
    const p = point(event);
    pointers.set(event.pointerId, p);
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    if (pointers.size === 1) {
      const node = hit(p);
      gesture = {
        ...p,
        moved: false,
        node,
        offsetX: node >= 0 ? p.x - screenX(node) : 0,
        offsetY: node >= 0 ? p.y - screenY(node) : 0,
      };
      focus(node);
    } else {
      releaseNode();
      if (gesture) gesture.moved = true;
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        x: (a!.x + b!.x) / 2,
        y: (a!.y + b!.y) / 2,
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
        distance = Math.hypot(a!.x - b!.x, a!.y - b!.y),
        x = (a!.x + b!.x) / 2,
        y = (a!.y + b!.y) / 2;
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
    if (gesture.node >= 0) {
      const node = nodes[gesture.node]!;
      node.fx = (p.x - camera.x - gesture.offsetX) / camera.scale;
      node.fy = (p.y - camera.y - gesture.offsetY) / camera.scale;
      // The grabbed particle follows the hand exactly; only its neighbors spring.
      node.x = node.fx;
      node.y = node.fy;
      if (!reduced)
        simulation.alphaTarget(0.12).alpha(Math.max(0.12, simulation.alpha()));
      startPhysics();
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
        ? (gesture?.node ?? -1)
        : -1;
    if (
      event.type !== 'pointerup' ||
      (gesture && gesture.node >= 0) ||
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
      gesture = { ...p!, moved: true, node: -1, offsetX: 0, offsetY: 0 };
    } else {
      gesture = undefined;
      focus(event.pointerType === 'touch' ? -1 : hit(point(event)));
    }
    invalidate();
    if (clicked >= 0) {
      const { href } = nodes[clicked]!;
      if (event.ctrlKey || event.metaKey)
        window.open(href, '_blank', 'noopener');
      else window.location.assign(href);
    }
  }
  listen('pointerup', endPointer);
  listen('pointercancel', endPointer);
  listen('lostpointercapture', endPointer);
  listen('pointerleave', () => {
    if (!gesture) focus(-1);
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
    stopBloom();
    if (event.key === 'Escape') {
      focus(-1);
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
      ].includes(event.key)
    )
      event.preventDefault();
    else return;
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key === '0' || event.key === 'Home') {
      stopCamera();
      fit();
    } else if (event.key === 'Enter' && selected >= 0)
      window.location.assign(nodes[selected]!.href);
    else if (event.key === '[' || event.key === ']') {
      if (!count) return;
      keyboardIndex =
        (keyboardIndex + (event.key === ']' ? 1 : -1) + count) % count;
      focus(keyboardIndex);
      const x = screenX(keyboardIndex),
        y = screenY(keyboardIndex);
      if (x < 30 || x > width - 30 || y < 30 || y > height - 40) {
        const node = nodes[keyboardIndex]!;
        moveCamera({
          ...camera,
          x: width / 2 - node.x * camera.scale,
          y: height / 2 - node.y * camera.scale,
        });
        manipulated = true;
      }
    } else if (event.key !== 'Enter') {
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
  listen('focus', () => focus(count ? keyboardIndex : -1));
  listen('blur', () => {
    if (!gesture) focus(-1);
  });
  function resize() {
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
    const oldWidth = width,
      oldHeight = height;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    if (canvas.width !== Math.round(width * dpr))
      canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr))
      canvas.height = Math.round(height * dpr);
    layoutGrid();
    if (!manipulated) fit(false);
    else {
      camera.x += (width - oldWidth) / 2;
      camera.y += (height - oldHeight) / 2;
      targetCamera.x += (width - oldWidth) / 2;
      targetCamera.y += (height - oldHeight) / 2;
    }
    invalidate();
  }
  function layoutGrid() {
    columns = Math.ceil(width / CELL_W) + 1;
    rows = Math.ceil(height / CELL_H) + 1;
    if (occupied.length < columns * rows)
      occupied = new Uint8Array(columns * rows);
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting && !document.hidden;
    if (visible) {
      if (simulation.alpha() >= simulation.alphaMin()) startPhysics();
      invalidate();
    } else {
      stopBloom();
      stopPhysics();
      stopCamera();
    }
  });
  visibility.observe(canvas);
  function visibilityChange() {
    if (document.hidden) {
      stopBloom();
      stopPhysics();
      visible = false;
    } else {
      const rect = canvas.getBoundingClientRect();
      visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (visible && simulation.alpha() >= simulation.alphaMin())
        startPhysics();
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
        stopBloom();
        stopPhysics();
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
  // Nothing animates to rest under reduced motion, so it may spend longer
  // settling up front; otherwise any remaining cooling runs live.
  if (reduced) warmUp(simulation, 160);
  readPalette();
  resize();
  // Every arrival unfurls from the current note; nothing is nudged or reheated.
  startBloom();
  void document.fonts.ready.then(() => {
    if (!disposed) readPalette();
  });
  return {
    bloom: startBloom,
    resize,
    /** Paint the collapsed sidebar view into `target`, leaving this canvas as it was. */
    paintCollapsed(
      target: HTMLCanvasElement,
      nextWidth: number,
      nextHeight: number,
    ) {
      if (!savedCamera) return;
      cancelAnimationFrame(frame);
      frame = 0;
      const previous = {
        width,
        height,
        camera,
        targetCamera,
        emphasis,
        reveal,
        bloom,
      };
      const fades = [focusOf.slice(), opacityOf.slice(), labelOf.slice()];
      // The sidebar shows where notes rest, not where a bloom has carried them.
      bloom = undefined;
      bloomEdges = bloomLabels = 1;
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      layoutGrid();
      camera = {
        scale: savedCamera.scale,
        x: savedCamera.x + (width - savedCamera.width) / 2,
        y: savedCamera.y + (height - savedCamera.height) / 2,
      };
      targetCamera = { ...camera };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // Settled, so labels match what the sidebar shows once it is live again.
      draw(performance.now(), 'settled');
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext('2d')?.drawImage(canvas, 0, 0);
      ({ width, height, camera, targetCamera, emphasis, reveal, bloom } =
        previous);
      focusOf.set(fades[0]!);
      opacityOf.set(fades[1]!);
      labelOf.set(fades[2]!);
      layoutGrid();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      advanceBloom(performance.now());
      draw(performance.now(), true);
      invalidate();
    },
    expand(value: boolean) {
      if (expanded === value) {
        resize();
        return;
      }
      stopCamera();
      expanded = value;
      if (value) {
        savedCamera = { ...camera, width, height };
        resize();
        fit(false);
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
        stopBloom();
        paintNow('settled');
      }
    },
    destroy() {
      disposed = true;
      stopBloom();
      stopPhysics();
      abort.abort();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
    },
  };
}
