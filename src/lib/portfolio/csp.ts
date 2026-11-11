/**
 * The CSP hashes for the portfolio's two inline pieces: the canvas style and
 * the appearance pre-paint script (both rendered by Prepaint.astro).
 *
 * Every page that uses the Portfolio layout calls registerPortfolioCsp from
 * its own frontmatter. Not from the layout or a component: on a streamed
 * server-rendered page Astro builds the Content-Security-Policy header once
 * the page's frontmatter has run, before the layout renders, so a hash added
 * later never reaches the header and the browser would block the pre-paint.
 * Prerendered pages take the same path, so there is one rule for both.
 *
 * Server-only (node:crypto); the client imports appearance.ts, not this.
 */
import { createHash } from 'node:crypto';
import {
  APPEARANCE_CANVAS_STYLE,
  APPEARANCE_PREPAINT_SCRIPT,
} from './appearance';

type CspHash = `sha256-${string}`;

interface CspApi {
  insertScriptHash(hash: CspHash): void;
  insertStyleHash(hash: CspHash): void;
}

export const sha256Source = (source: string): CspHash =>
  `sha256-${createHash('sha256').update(source).digest('base64')}`;

export const APPEARANCE_STYLE_HASH = sha256Source(APPEARANCE_CANVAS_STYLE);
export const APPEARANCE_SCRIPT_HASH = sha256Source(APPEARANCE_PREPAINT_SCRIPT);

/**
 * There is no unhashed path: a production render without the CSP API fails
 * instead of shipping inline code the policy would not cover.
 */
export function registerPortfolioCsp(
  csp: CspApi | undefined,
  production: boolean,
): void {
  if (csp) {
    csp.insertStyleHash(APPEARANCE_STYLE_HASH);
    csp.insertScriptHash(APPEARANCE_SCRIPT_HASH);
  } else if (production) {
    throw new Error(
      'Portfolio pre-paint needs Astro.csp to register its hashes; refusing to render unhashed inline code.',
    );
  }
}
