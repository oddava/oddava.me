// GitHub-style callouts — a blockquote whose first line is `[!NOTE]` — shared
// by the public renderer, Studio's preview, and the rich editor, so all three
// agree on what is a callout and what one looks like.

export const CALLOUT_KINDS = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export interface CalloutStyle {
  label: string;
  /** SVG children on a 20px grid, drawn with the page's current text colour. */
  icon: string;
}

export const CALLOUTS: Readonly<Record<CalloutKind, CalloutStyle>> = {
  note: {
    label: 'Note',
    icon: '<circle cx="10" cy="10" r="6.5"/><path d="M10 9.25v4M10 6.75h.01"/>',
  },
  tip: {
    label: 'Tip',
    icon: '<path d="M10 3.75a4.5 4.5 0 0 0-2.4 8.3c.5.35.65.7.65 1.2h3.5c0-.5.15-.85.65-1.2A4.5 4.5 0 0 0 10 3.75zM8 16h4"/>',
  },
  important: {
    label: 'Important',
    icon: '<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 14 13h-4.5L6.5 16v-3H6a1.5 1.5 0 0 1-1.5-1.5zM10 6.75v2.5M10 11h.01"/>',
  },
  warning: {
    label: 'Warning',
    icon: '<path d="M10 4.25 17 16H3zM10 8.75v3M10 13.75h.01"/>',
  },
  caution: {
    label: 'Caution',
    icon: '<path d="M7 3.75h6L16.25 7v6L13 16.25H7L3.75 13V7zM10 7v3.5M10 13h.01"/>',
  },
};

export function isCalloutKind(value: unknown): value is CalloutKind {
  return (CALLOUT_KINDS as readonly unknown[]).includes(value);
}

/** The icon as markup. Static strings only: nothing author-written reaches it. */
export function calloutIconSvg(kind: CalloutKind): string {
  return `<svg class="callout__icon" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${CALLOUTS[kind].icon}</svg>`;
}

/** The finished callout, given its body already rendered to HTML. */
export function renderCalloutHtml(kind: CalloutKind, bodyHtml: string): string {
  return `<div class="callout callout--${kind}" role="note"><div class="callout__title">${calloutIconSvg(kind)}<span class="callout__label">${CALLOUTS[kind].label}</span></div><div class="callout__body">${bodyHtml}</div></div>\n`;
}

const MARKER = new RegExp(
  `^ {0,3}>[ \\t]?\\[!(${CALLOUT_KINDS.join('|')})\\][ \\t]*$`,
  'i',
);
const QUOTED_LINE = /^ {0,3}>[ \t]?(.*)$/;
/** A cheap first-line test that never looks past the opening `[!`. */
const OPENING_PREFIX = /^ {0,3}>[ \t]?\[!/;

/** Where the line starting at `start` ends: its `\n`, or the end of `source`. */
export function lineEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end < 0 ? source.length : end;
}

export interface CalloutSource {
  kind: CalloutKind;
  /** The quoted text with its `>` prefixes removed, marker line excluded. */
  body: string;
  /** Exactly the source lines the callout occupies. */
  raw: string;
}

/**
 * The callout at the start of `source`, or null. The marker must stand alone
 * on its line; anything after it (an Obsidian-style title, say) is not a
 * callout here, so such a quote stays a plain quote everywhere rather than
 * being half-understood. The body is the run of `>` lines that follows.
 */
export function readCallout(source: string): CalloutSource | null {
  // Marked offers this every block of every note with the whole rest of the
  // note as `source`, so it must cost what the callout costs, not what the
  // note costs: reject on the first line, then walk lines by index rather
  // than splitting everything after them.
  if (!OPENING_PREFIX.test(source)) return null;
  const firstEnd = lineEnd(source, 0);
  const opening = MARKER.exec(source.slice(0, firstEnd));
  if (!opening) return null;
  const body: string[] = [];
  let end = firstEnd;
  for (let start = firstEnd + 1; start <= source.length;) {
    const next = lineEnd(source, start);
    const quoted = QUOTED_LINE.exec(source.slice(start, next));
    if (!quoted) break;
    body.push(quoted[1]!);
    end = next;
    start = next + 1;
  }
  return {
    kind: opening[1]!.toLowerCase() as CalloutKind,
    body: body.join('\n').replace(/\n+$/, ''),
    raw: source.slice(0, end),
  };
}

/** Whether any line of `source` is a callout marker, nested or not. */
export function mentionsCallout(source: string): boolean {
  return new RegExp(
    `^[ \\t]*>[ \\t>]*\\[!(?:${CALLOUT_KINDS.join('|')})\\][ \\t]*$`,
    'im',
  ).test(source);
}

/** A callout's Markdown, given its body already serialized. */
export function writeCallout(kind: CalloutKind, body: string): string {
  const quoted = body
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return `> [!${kind.toUpperCase()}]${body ? `\n${quoted}` : ''}`;
}
