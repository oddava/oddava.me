/**
 * Temporary homepage skins.
 *
 * Flip `HOME_THEME` to `'default'` (or any non-spiderman value) to restore the
 * stock landing page with no leftover markup, styles, or behaviour. All
 * Spider-Man visuals live under this flag: `data-skin` on `<html>`, the
 * `SpidermanTheme` decor component, and `_home-spiderman.css`.
 */

export type HomeTheme = 'default' | 'spiderman';

/** Single switch for the homepage visual skin. */
export const HOME_THEME: HomeTheme = 'spiderman';

export function isSpidermanHomeTheme(
  theme: HomeTheme = HOME_THEME,
): theme is 'spiderman' {
  return theme === 'spiderman';
}
