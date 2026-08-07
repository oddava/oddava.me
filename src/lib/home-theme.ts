/**
 * Temporary homepage skins.
 *
 * The permanent identity is `'default'` — steel-blue drafting paper and the
 * plotted business card. Spider-Man is an optional seasonal overlay only.
 *
 * Flip `HOME_THEME` to `'default'` to restore the stock landing page with no
 * leftover markup, styles, or behaviour. All Spider-Man visuals live under
 * this flag: `data-skin` on `<html>`, the `SpidermanTheme` decor component,
 * and `_home-spiderman.css`.
 */

export type HomeTheme = 'default' | 'spiderman';

/**
 * Single switch for the homepage visual skin.
 * Use `'default'` for the permanent look; `'spiderman'` for the temporary skin.
 */
export const HOME_THEME: HomeTheme = 'spiderman';

export function isSpidermanHomeTheme(
  theme: HomeTheme = HOME_THEME,
): theme is 'spiderman' {
  return theme === 'spiderman';
}
