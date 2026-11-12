/**
 * Where the sky's moon hangs, in the same coordinates as the stars (fractions
 * of the stars' field, see components/sky/render.ts), so a star and the moon
 * keep the same distance on every screen and in both themes.
 *
 * No new star may be placed in the zone around it: the page refuses the
 * spot and the server refuses the star. A star placed there before is drawn
 * over the moon, never hidden behind it.
 */
export const MOON = { x: 0.86, y: 0.1 } as const;

/** Half the zone's width and height, in field fractions. */
export const MOON_ZONE = { x: 0.075, y: 0.13 } as const;

/**
 * The moon's radius in CSS px for a sky `width` wide whose stars' field is
 * `fieldWidth` × `fieldHeight`: at most 22, and never more than 60% of the
 * zone's half-size either way, so on a short screen the zone still clears
 * the disc by enough that no star beside it is half under the moon.
 *
 * The 9px floor keeps the moon a moon; it holds the 8px clearance only for
 * a field at least ~113px tall. The sky's minimum height (_sky.css) keeps
 * the field near 177px today; tests/sky-render.test.ts pins the clearance,
 * so a layout that shrinks the field below that fails there first.
 */
export function moonRadius(
  width: number,
  fieldWidth: number,
  fieldHeight: number,
): number {
  return Math.max(
    9,
    Math.min(
      22,
      width * 0.018,
      MOON_ZONE.y * fieldHeight * 0.6,
      MOON_ZONE.x * fieldWidth * 0.6,
    ),
  );
}

/** Whether a field point is on the moon or close enough to crowd it. */
export function inMoonZone(x: number, y: number): boolean {
  return Math.hypot((x - MOON.x) / MOON_ZONE.x, (y - MOON.y) / MOON_ZONE.y) < 1;
}
