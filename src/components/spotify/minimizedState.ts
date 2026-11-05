export const MINIMIZED_STORAGE_KEY = 'spotify-widget-minimized';
export const MOBILE_MINIMIZE_QUERY = '(max-width: 640px)';
/**
 * A landscape phone: docked, and too short for the homepage nav to clear the
 * expanded strip (568x320 puts the nav's bottom edge inside the strip's band).
 */
export const SHORT_DOCK_QUERY = '(max-width: 640px) and (max-height: 420px)';

/**
 * A stored preference ('true'/'false') wins, except on a short docked
 * viewport, which always starts minimized: the expanded strip would cover the
 * homepage nav there. Without a preference, small viewports default to
 * minimized because the fixed bottom-left card overlaps content there.
 * Anything else stored falls back to the viewport default.
 */
export function resolveInitialMinimized(
  stored: string | null,
  isSmallViewport: boolean,
  isShortDockedViewport = false,
): boolean {
  if (isShortDockedViewport) return true;
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return isSmallViewport;
}
