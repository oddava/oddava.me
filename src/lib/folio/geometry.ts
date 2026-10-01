/** The island is fixed geometry; interaction moves only its surrounding accents. */
export interface FolioView {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  quietWidth: number;
  quietHeight: number;
}

export const TAU = Math.PI * 2;

export function folioPoint(angle: number, view: FolioView): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const mobile = view.width < 900;
  const rx = mobile
    ? Math.min(view.width / 2 - 12, view.quietWidth / 2 + 42)
    : view.quietWidth / 2 + 48;
  // Keep wider mobile/tablet layouts from becoming a shallow, swollen head.
  const ry = mobile
    ? Math.max(view.quietHeight / 2 + 34, rx * 0.7)
    : view.quietHeight / 2 + 60;
  const ear = (tip: number) => {
    const distance = Math.sqrt((angle - tip) ** 2 + 0.0016) - 0.04;
    const profile = Math.max(0, 1 - distance / 0.43);
    return profile * profile * (3 - 2 * profile);
  };
  const ears = ear(4.02) + ear(5.405);
  return [
    view.centerX + c * (1 + 0.14 * s * s) * rx + ears * c * 7,
    view.centerY +
      (mobile ? 12 : 0) +
      s * (1 + 0.14 * c * c) * ry -
      ears * ry * (mobile ? 0.52 : 0.64),
  ];
}

export function folioPath(view: FolioView): string {
  const samples = view.width < 900 ? 96 : 160;
  const points = Array.from({ length: samples }, (_, i) =>
    folioPoint((i / samples) * TAU, view),
  );
  const midpoint = (a: number[], b: number[]) =>
    `${((a[0]! + b[0]!) / 2).toFixed(2)},${((a[1]! + b[1]!) / 2).toFixed(2)}`;
  return `M${midpoint(points.at(-1)!, points[0]!)} ${points
    .map(
      (point, i) =>
        `Q${point[0].toFixed(2)},${point[1].toFixed(2)} ${midpoint(point, points[(i + 1) % points.length]!)}`,
    )
    .join(' ')} Z`;
}

/** One shared, tilted orbit supplies both the thread and the authored placements. */
function orbitPoint(angle: number, view: FolioView): [number, number] {
  const x = Math.cos(angle) * (view.quietWidth / 2 + 200);
  const y = Math.sin(angle) * (view.quietHeight / 2 + 205);
  return [
    view.centerX + x * Math.cos(-0.22) - y * Math.sin(-0.22),
    view.centerY + x * Math.sin(-0.22) + y * Math.cos(-0.22),
  ];
}

export function folioOrbit(view: FolioView): string {
  if (view.width < 900) {
    const { width: w, height: h, centerY, quietHeight } = view;
    const top = Math.max(60, centerY - quietHeight / 2 - 110);
    const bottom = Math.min(folioPoint(Math.PI / 2, view)[1] + 52, h - 100);
    return `M${w * 0.14} ${top} Q${w * 0.46} ${top - 35} ${w * 0.85} ${top + 12} M${w * 0.21} ${bottom} Q${w * 0.5} ${bottom + 56} ${w * 0.79} ${bottom}`;
  }
  return Array.from({ length: 129 }, (_, i) => {
    const [x, y] = orbitPoint((i / 128) * TAU, view);
    return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

export function folioAccents(view: FolioView): [number, number][] {
  const { width, height, centerY, quietHeight } = view;
  if (width < 900) {
    const top = centerY - quietHeight / 2 - 88;
    const bottom = centerY + quietHeight / 2 + 28;
    return [
      [width * 0.2, 30],
      [width * 0.78, Math.max(42, top - 58)],
      [width * 0.2, height - 35],
      [width * 0.8, height - 35],
      [width * 0.22, Math.max(28, top - 22)],
      [width * 0.66, Math.min(height - 32, bottom + 50)],
    ];
  }
  return [3.4, 5.65, 2.2, 0.15, 4.5, 1.18].map((angle) =>
    orbitPoint(angle, view),
  );
}

/** Authored pockets of dust, with generous gaps rather than a random starfield. */
export function folioStars(view: FolioView): [number, number, number][] {
  const placements = [
    [0.08, 0.18, 0.6],
    [0.115, 0.205, 0.4],
    [0.17, 0.12, 2.2],
    [0.24, 0.24, 0.55],
    [0.29, 0.09, 0.4],
    [0.39, 0.17, 0.55],
    [0.56, 0.08, 0.45],
    [0.64, 0.23, 0.55],
    [0.79, 0.13, 0.65],
    [0.835, 0.165, 0.4],
    [0.92, 0.27, 0.55],
    [0.88, 0.43, 2],
    [0.13, 0.42, 0.45],
    [0.055, 0.57, 0.6],
    [0.2, 0.66, 0.5],
    [0.09, 0.83, 0.4],
    [0.28, 0.88, 2.4],
    [0.325, 0.84, 0.5],
    [0.43, 0.93, 0.4],
    [0.58, 0.81, 0.55],
    [0.68, 0.9, 0.45],
    [0.78, 0.72, 0.6],
    [0.82, 0.755, 0.4],
    [0.94, 0.86, 0.55],
  ];
  return placements.map(([u, v, size], i) => {
    // Keep the same authored marks, but only eight quiet anchors on phones.
    if (view.width < 900 && ![0, 2, 6, 8, 15, 16, 20, 23].includes(i))
      return [u! * view.width, v! * view.height, 0];
    const x = u! * view.width;
    const y = v! * view.height;
    // Includes drift and pointer displacement, even on a narrow phone.
    if (
      Math.abs(x - view.centerX) < view.quietWidth / 2 + 40 &&
      Math.abs(y - view.centerY) < view.quietHeight / 2 + 40
    )
      return [x, y, 0];
    return [x, y, size!];
  });
}

/** Navigation replaces three orbit ornaments; portrait screens use a lower constellation. */
export function folioWaypoints(view: FolioView): [number, number][] {
  if (view.width >= 900) {
    const accents = folioAccents(view);
    return [accents[2]!, accents[1]!, accents[5]!];
  }
  const bottom = folioPoint(Math.PI / 2, view)[1];
  const y = Math.min(bottom + 62, view.height - 90);
  const spread = Math.min(view.width * 0.29, 145);
  return [
    [view.centerX - spread, y],
    [view.centerX, y + 28],
    [view.centerX + spread, y],
  ];
}
