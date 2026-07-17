export const MINIMIZED_STORAGE_KEY = 'spotify-widget-minimized';
export const MOBILE_MINIMIZE_QUERY = '(max-width: 640px)';

/**
 * A stored preference ('true'/'false') always wins. Without one, small
 * viewports default to minimized because the fixed bottom-left card overlaps
 * content there. Anything else stored falls back to the viewport default.
 */
export function resolveInitialMinimized(
  stored: string | null,
  isSmallViewport: boolean,
): boolean {
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return isSmallViewport;
}
