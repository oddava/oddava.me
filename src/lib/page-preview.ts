import { NOTE_FALLBACK_DESCRIPTION, SITE_DESCRIPTION } from './site';

const NON_PAGE_PREFIXES = ['/admin', '/api', '/fonts', '/images'];
const NON_HTML_FILE =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|mjs|pdf|png|svg|webp|xml)(?:$|\/)/i;

/**
 * Resolve a link to the canonical URL used by the hover-preview cache.
 *
 * Returning `null` keeps the browser enhancement away from links that are not
 * public HTML pages. Hashes are deliberately removed: every section of one
 * page shares the same preview and therefore the same cache entry.
 */
export function previewPageUrl(
  href: string,
  currentHref: string,
): string | null {
  let target: URL;
  let current: URL;

  try {
    current = new URL(currentHref);
    target = new URL(href, current);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(target.protocol)) return null;
  if (target.origin !== current.origin) return null;
  if (
    NON_PAGE_PREFIXES.some(
      (prefix) =>
        target.pathname === prefix || target.pathname.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }
  if (NON_HTML_FILE.test(target.pathname)) return null;
  if (
    target.pathname === current.pathname &&
    target.search === current.search
  ) {
    return null;
  }

  target.hash = '';
  return target.href;
}

/* ---------------------------------------------------------------------------
   Placement geometry

   Kept pure and DOM-free so the interesting part — which side of the link the
   sheet takes, how it avoids the viewport edges, where the leader line meets
   it — is testable without a browser. The component supplies measured rects.
   --------------------------------------------------------------------------- */

export type PreviewSide = 'above' | 'below';

export interface PreviewRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PreviewPlacementInput {
  /** The line box of the hovered link the preview should attach to. */
  anchor: PreviewRect;
  /** Viewport x of the pointer, or `null` for keyboard focus. */
  pointerX: number | null;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Keep-out distance from the viewport edges. */
  margin: number;
  /** Distance between the link's line box and the sheet. */
  gap: number;
  /** How far the sheet's leading edge sits ahead of the attachment point. */
  lead: number;
}

export interface PreviewPlacement {
  x: number;
  y: number;
  side: PreviewSide;
  /** Where the leader line meets the sheet, relative to its leading edge. */
  tetherX: number;
}

/** Keeps the leader line from landing on a rounded corner. */
const TETHER_INSET = 14;
/** Keyboard focus has no pointer, so attach a little way into the link text. */
const KEYBOARD_ORIGIN_OFFSET = 32;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Decide where the preview sheet sits for a given link and pointer.
 *
 * The horizontal attachment point follows the cursor but is clamped inside the
 * hovered line box, so the sheet always reads as belonging to the words under
 * the pointer rather than to the link element's bounding box — which, for a
 * link wrapped across two lines, is somewhere the reader is not looking.
 */
export function resolvePreviewPlacement(
  input: PreviewPlacementInput,
): PreviewPlacement {
  const { anchor, panel, viewport, margin, gap, lead } = input;

  const originX =
    input.pointerX === null
      ? Math.min(anchor.left + KEYBOARD_ORIGIN_OFFSET, anchor.right)
      : clamp(input.pointerX, anchor.left, anchor.right);

  const maxX = Math.max(margin, viewport.width - panel.width - margin);
  const x = clamp(originX - lead, margin, maxX);

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - panel.height;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = anchor.top - gap - margin;

  let side: PreviewSide;
  let y: number;
  if (panel.height <= roomBelow) {
    side = 'below';
    y = below;
  } else if (above >= margin) {
    side = 'above';
    y = above;
  } else if (roomAbove > roomBelow) {
    // Neither side fits. Take the roomier one and let the sheet clip at the
    // edge rather than drifting away from the link it belongs to.
    side = 'above';
    y = margin;
  } else {
    side = 'below';
    y = Math.max(margin, Math.min(below, viewport.height - margin));
  }

  return {
    x,
    y,
    side,
    tetherX: clamp(
      originX - x,
      TETHER_INSET,
      Math.max(TETHER_INSET, panel.width - TETHER_INSET),
    ),
  };
}

/* ---------------------------------------------------------------------------
   Content composition

   The component hands over strings it scraped from the fetched document; every
   decision about what the miniature document actually shows lives here.
   --------------------------------------------------------------------------- */

export interface PreviewSource {
  pathname: string;
  heading?: string | null;
  documentTitle?: string | null;
  description?: string | null;
  /** First substantial paragraph, used when the page has no description. */
  lead?: string | null;
  /** Human-readable date already formatted by the page itself. */
  updated?: string | null;
  wordCount?: number | null;
}

export interface PreviewContent {
  path: string;
  title: string;
  excerpt: string;
  meta: string;
}

/**
 * The descriptions the site falls back to when a page never wrote its own.
 * They describe the site, not the destination, so a preview showing one would
 * say the same thing about every link on the page — the page's own opening
 * line is used instead.
 */
const BOILERPLATE_DESCRIPTIONS = new Set(
  [SITE_DESCRIPTION, NOTE_FALLBACK_DESCRIPTION].map((value) =>
    value.toLowerCase(),
  ),
);

const SITE_TITLE_SUFFIX = /\s*[|·—-]\s*oddava(?:\.me)?\s*$/i;
const EXCERPT_LIMIT = 190;
const WORDS_PER_MINUTE = 220;
/** Below this a reading time says nothing useful, so it is left off. */
const READING_TIME_FLOOR = 80;
const PATH_SEGMENT_LIMIT = 3;

const collapse = (value: string | null | undefined) =>
  value?.replace(/\s+/g, ' ').trim() ?? '';

/**
 * Render a pathname as a breadcrumb trail. Deep paths keep their first and
 * last segment — the section and the page — and elide the middle, which is
 * what a reader needs to place the destination.
 */
export function formatPreviewPath(pathname: string): string {
  let segments: string[];
  try {
    segments = decodeURI(pathname).split('/').filter(Boolean);
  } catch {
    segments = pathname.split('/').filter(Boolean);
  }
  if (segments.length === 0) return 'home';
  if (segments.length > PATH_SEGMENT_LIMIT) {
    segments = [segments[0]!, '…', segments[segments.length - 1]!];
  }
  return segments.join(' / ');
}

/** Trim to a whole word, never leaving dangling punctuation before the ellipsis. */
export function truncateExcerpt(value: string, limit = EXCERPT_LIMIT): string {
  const text = collapse(value);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  const kept = boundary > limit * 0.6 ? cut.slice(0, boundary) : cut;
  return `${kept.replace(/[\s,;:.–—-]+$/, '')}…`;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Build the preview's four fields, or `null` when the fetched document has no
 * title — which is the one signal that it is not a readable page.
 */
export function composePreviewContent(
  source: PreviewSource,
): PreviewContent | null {
  const title =
    collapse(source.heading) ||
    collapse(source.documentTitle).replace(SITE_TITLE_SUFFIX, '');
  if (!title) return null;

  const meta: string[] = [];
  const updated = collapse(source.updated);
  if (updated) {
    // The note page renders the date inside its own `edited <time>` line; the
    // scraper pulls only the `<time>` text, so prefix it here. The regex keeps
    // a date that already shipped with its own verb from being doubled.
    meta.push(/^edited\b/i.test(updated) ? updated : `edited ${updated}`);
  }
  const words = source.wordCount ?? 0;
  if (words >= READING_TIME_FLOOR) {
    meta.push(`${readingMinutes(words)} min read`);
  }

  const description = collapse(source.description);
  const summary = BOILERPLATE_DESCRIPTIONS.has(description.toLowerCase())
    ? ''
    : description;

  return {
    path: formatPreviewPath(source.pathname),
    title,
    excerpt: truncateExcerpt(summary || collapse(source.lead)),
    meta: meta.join(' · '),
  };
}
