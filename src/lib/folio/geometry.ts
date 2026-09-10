/** An engraved sheet: each curve is one continuous edge of the same folio.
 * Coordinates are CSS pixels; the renderer alone deals with device pixels. */
export interface FolioView {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  quietWidth: number;
  quietHeight: number;
}

export interface FolioPointer {
  x: number;
  y: number;
  strength: number;
}

export const FOLIO_PAGE_COUNT = 3;

export const TAU = Math.PI * 2;

/** Rounded cheeks and two soft pointed ears frame the measured copy.
 * The fold grows outwards, so even the most energetic sheet stays outside it. */
export function folioPoint(
  angle: number,
  layer: number,
  time: number,
  page: number,
  view: FolioView,
  pointer: FolioPointer,
): [number, number] {
  const { width, height, centerX, centerY, quietWidth, quietHeight } = view;
  const phase = page * (TAU / FOLIO_PAGE_COUNT);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const fold = Math.sin(angle * 3 + phase + layer * 2.2 + time * 0.075);
  const reach = Math.min(width, height) * layer;
  const rx = quietWidth / 2 + 60 + reach * (0.48 + fold * 0.05);
  const ry = quietHeight / 2 + 70 + reach * (0.42 + fold * 0.06);
  // Exponent < 1 makes the inner edge a superellipse, protecting text corners.
  let x = centerX + Math.sign(c) * Math.abs(c) ** 0.9 * rx;
  let y = centerY + Math.sign(s) * Math.abs(s) ** 0.9 * ry;
  x += Math.sin(angle * 2 + phase + time * 0.055) * reach * 0.045;
  y += Math.cos(angle * 2 - phase + layer * 2.5) * reach * 0.035;

  // Only the first contour is a cat; surrounding lines keep their flowing shape.
  if (layer === 0) {
    // Two compact peaks grow out of the forehead; the center stays low between
    // them. A softened triangular profile reads as ears rather than round bumps.
    const ear = (tip: number) => {
      const distance =
        Math.sqrt((angle - tip) ** 2 + 0.0008) - Math.sqrt(0.0008);
      return Math.max(0, 1 - distance / 0.43) ** 1.35;
    };
    const ears =
      ear(4.02 + Math.sin(time * 0.12 + phase) * 0.018) +
      ear(5.405 + Math.sin(time * 0.11 + phase) * 0.018);
    y -= ears * ry * 0.64;
    x += ears * Math.sign(c) * rx * 0.035;
  }

  const dx = x - pointer.x;
  const dy = y - pointer.y;
  const distance = Math.hypot(dx, dy);
  const influence = Math.exp(-(distance * distance) / (145 * 145));
  const lift = influence * pointer.strength * (16 + 18 * layer);
  // Tangential displacement feels like lifting a leaf instead of blowing dust.
  x += c * lift * 0.45;
  y += s * lift - lift * 0.65;
  return [x, y];
}

export function folioPath(layer: number, view: FolioView): string {
  const points: string[] = [];
  for (let step = 0; step <= 160; step++) {
    const [x, y] = folioPoint((step / 160) * TAU, layer, 0, 0, view, {
      x: -1000,
      y: -1000,
      strength: 0,
    });
    points.push(`${step ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}
