// The workspace's icon set. One 20px grid, one 1.5 stroke, round joins — every
// control glyph in Studio comes from here, so no two buttons draw the same idea
// differently and no text character stands in for an icon.

const PATHS = {
  'chevron-right': <path d="m8 5 5 5-5 5" />,
  'chevron-left': <path d="m12 5-5 5 5 5" />,
  'chevron-down': <path d="m5 8 5 5 5-5" />,
  doc: (
    <path d="M6 3.75h5.25L15 7.5v7.75a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1zM11 3.75V7.5h4M7.75 11h4.5M7.75 13.75h3" />
  ),
  close: <path d="m5.5 5.5 9 9m0-9-9 9" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  check: <path d="m4.75 10.5 3.5 3.5 7-7.5" />,
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="4.75" />
      <path d="m12.25 12.25 3.75 3.75" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M8 4v12" />
    </>
  ),
  external: (
    <>
      <path d="M8.5 4.75h-3A1.75 1.75 0 0 0 3.75 6.5v8a1.75 1.75 0 0 0 1.75 1.75h8a1.75 1.75 0 0 0 1.75-1.75v-3" />
      <path d="M11.5 3.75h4.75V8.5M16 4l-7 7" />
    </>
  ),
  home: (
    <path d="M3.75 9.25 10 4l6.25 5.25v6.5a.5.5 0 0 1-.5.5h-3.5v-4.5h-4.5v4.5h-3.5a.5.5 0 0 1-.5-.5z" />
  ),
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7.5" cy="8.25" r="1.25" />
      <path d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3" />
    </>
  ),
  trash: (
    <path d="M4 6h12M8.25 6V4.5h3.5V6M5.75 6l.6 9.1a1.5 1.5 0 0 0 1.5 1.4h4.3a1.5 1.5 0 0 0 1.5-1.4l.6-9.1" />
  ),
  upload: (
    <path d="M10 13V4m-3.5 3.5L10 4l3.5 3.5M4.5 13.5v1.75c0 .55.45 1 1 1h9c.55 0 1-.45 1-1V13.5" />
  ),
  save: (
    <path d="M5 3.75h7.5l3.25 3.25v8.25a1 1 0 0 1-1 1H5.25a1 1 0 0 1-1-1V4.75a1 1 0 0 1 .75-1zM7 3.75v4h5v-4M7 16.25v-4.5h6v4.5" />
  ),
  refresh: <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.75 3.75v3.5h-3.5" />,
  eye: (
    <>
      <path d="M2.75 10S5.5 4.75 10 4.75 17.25 10 17.25 10 14.5 15.25 10 15.25 2.75 10 2.75 10z" />
      <circle cx="10" cy="10" r="2.25" />
    </>
  ),
  'eye-off': (
    <path d="M8.2 5a7.6 7.6 0 0 1 1.8-.25c4.5 0 7.25 5.25 7.25 5.25a13 13 0 0 1-1.9 2.6M12.1 12.2A2.25 2.25 0 0 1 7.8 8.4M5.6 6.6C3.85 7.85 2.75 10 2.75 10S5.5 15.25 10 15.25a6.8 6.8 0 0 0 3.6-1.05M3.5 3.5l13 13" />
  ),
  'sign-out': (
    <path d="M8 16.25H5a1.25 1.25 0 0 1-1.25-1.25V5A1.25 1.25 0 0 1 5 3.75h3M12.75 13.5 16.25 10l-3.5-3.5M16 10H8" />
  ),
  // --- Blocks: what the slash menu, Turn into and the phone's bar make ---
  text: <path d="M5 5.25h10M10 5.25v10" />,
  'list-bullet': (
    <>
      <path d="M8.5 6h7.5M8.5 10h7.5M8.5 14h7.5" />
      <circle className="is-fill" cx="4.75" cy="6" r="1.1" />
      <circle className="is-fill" cx="4.75" cy="10" r="1.1" />
      <circle className="is-fill" cx="4.75" cy="14" r="1.1" />
    </>
  ),
  'list-ordered': (
    <path d="M9 6.25h7M9 13.25h7M4.25 4.75l1.25-.75v4.25M4 11.75c.15-.6.6-.95 1.2-.95.65 0 1.1.4 1.1 1 0 .95-2.3 1.65-2.3 3.2h2.4" />
  ),
  task: (
    <>
      <rect x="3.75" y="3.75" width="12.5" height="12.5" rx="3" />
      <path d="m7 10.25 2 2 4-4.5" />
    </>
  ),
  quote: <path d="M4.75 4.75v10.5M8.5 6.5h7M8.5 10h7M8.5 13.5h4.5" />,
  code: <path d="M7.5 6.5 4 10l3.5 3.5M12.5 6.5 16 10l-3.5 3.5" />,
  callout: (
    <>
      <path d="M5.5 4.25h9a1.75 1.75 0 0 1 1.75 1.75v6.5a1.75 1.75 0 0 1-1.75 1.75H11l-3 2.75v-2.75H5.5A1.75 1.75 0 0 1 3.75 12.5V6a1.75 1.75 0 0 1 1.75-1.75z" />
      <path d="M10 7.25v2.5M10 11.4h.01" />
    </>
  ),
  footnote: (
    <>
      <path d="M4.5 5.5h7M4.5 9h5M4.5 12.5h4" />
      <path d="M13 6.75 14.75 5v6.25" />
      <path d="M4.5 16.25h11" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8.25h14M3 12.25h14M10 8.25V16" />
    </>
  ),
  divider: <path d="M3.5 10h13M6.5 5.75h7M6.5 14.25h7" />,
  video: (
    <>
      <rect x="2.75" y="4.5" width="14.5" height="11" rx="2.5" />
      <path d="M8.75 7.75v4.5L12.5 10z" />
    </>
  ),
  'note-link': (
    <path d="M4.5 4.75H3v10.5h1.5M8.75 4.75h-1.5v10.5h1.5M11.25 4.75h1.5v10.5h-1.5M15.5 4.75H17v10.5h-1.5" />
  ),
  link: (
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3" />
    </>
  ),
  // --- Actions ---
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="1.75" />
      <path d="M13 7V5.25A1.25 1.25 0 0 0 11.75 4h-6.5A1.25 1.25 0 0 0 4 5.25v6.5A1.25 1.25 0 0 0 5.25 13H7" />
    </>
  ),
  'arrow-up': <path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />,
  'arrow-down': <path d="M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5" />,
  columns: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M10 4v12" />
    </>
  ),
  'columns-3': (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M7.75 4v12M12.25 4v12" />
    </>
  ),
  'column-wide-left': (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M12 4v12" />
    </>
  ),
  'column-wide-right': (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M8 4v12" />
    </>
  ),
  stack: (
    <>
      <rect x="4" y="3.75" width="12" height="5.5" rx="1.5" />
      <rect x="4" y="10.75" width="12" height="5.5" rx="1.5" />
    </>
  ),
  hash: <path d="M8.25 4 6.75 16M13.25 4l-1.5 12M4.5 7.75h11.5M4 12.25h11.5" />,
  expand: <path d="m6.5 7.75 3.5-3.5 3.5 3.5M6.5 12.25l3.5 3.5 3.5-3.5" />,
  collapse: <path d="m6.5 4.25 3.5 3.5 3.5-3.5M6.5 15.75l3.5-3.5 3.5 3.5" />,
  pencil: <path d="M12.5 4.5 15.5 7.5 7.5 15.5H4.5v-3zM10.75 6.25l3 3" />,
  folder: (
    <path d="M3.5 6.25c0-.69.56-1.25 1.25-1.25h3.5l1.5 1.75h5.5c.69 0 1.25.56 1.25 1.25v6.75c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25z" />
  ),
  'turn-into': <path d="M4.5 7.25h11l-3-3M15.5 12.75h-11l3 3" />,
  undo: <path d="M7.25 5 4 8.25l3.25 3.25M4.5 8.25h7.25a4 4 0 0 1 0 8H9.5" />,
  redo: (
    <path d="M12.75 5 16 8.25l-3.25 3.25M15.5 8.25H8.25a4 4 0 0 0 0 8h2.25" />
  ),
  indent: <path d="M4 4.75h12M9.5 10H16M4 15.25h12M4 7.75 6.75 10 4 12.25" />,
  // A heading and the shallower ones beneath it: the outline's own shape.
  outline: <path d="M4 5.25h12M7 10h9M10 14.75h6" />,
  outdent: (
    <path d="M4 4.75h12M9.5 10H16M4 15.25h12M6.75 7.75 4 10l2.75 2.25" />
  ),
  history: (
    <path d="M3.75 10a6.25 6.25 0 1 0 1.9-4.45M3.75 4v3.75h3.75M10 6.5V10l2.5 1.5" />
  ),
  keyboard: (
    <>
      <rect x="2.75" y="3.25" width="14.5" height="9.5" rx="1.75" />
      <path d="M6 6.5h.01M8.67 6.5h.01M11.33 6.5h.01M14 6.5h.01M6.75 9.5h6.5M7.5 15.25 10 17.25l2.5-2" />
    </>
  ),
  // Page style: a small letter and a large one. "Aa" as text is the find
  // bar's Match case, so the two never look like the same button.
  'text-size': (
    <path d="M2.5 15.5 4.75 10 7 15.5M3.3 13.5h2.9M9 15.5l4.25-11 4.25 11M10.35 12h5.8" />
  ),
  focus: (
    <>
      <path d="M4 7.5V5.25C4 4.56 4.56 4 5.25 4H7.5M12.5 4h2.25c.69 0 1.25.56 1.25 1.25V7.5M16 12.5v2.25c0 .69-.56 1.25-1.25 1.25H12.5M7.5 16H5.25C4.56 16 4 15.44 4 14.75V12.5" />
      <circle cx="10" cy="10" r="1.75" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS | 'more' | 'grip';

/** A control glyph. Always decorative: the button carrying it has the name. */
export function Icon({ name }: { name: IconName }) {
  if (name === 'more' || name === 'grip') {
    // Dots are filled, not stroked — a stroked dot at this size is a ring.
    const dots =
      name === 'more'
        ? [
            [5, 10],
            [10, 10],
            [15, 10],
          ]
        : [5.5, 10, 14.5].flatMap((y) => [
            [7.5, y],
            [12.5, y],
          ]);
    return (
      <svg
        className="studio-glyph"
        viewBox="0 0 20 20"
        aria-hidden="true"
        fill="currentColor"
        stroke="none"
      >
        {dots.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.35" />
        ))}
      </svg>
    );
  }
  return (
    <svg className="studio-glyph" viewBox="0 0 20 20" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The same dots for controls a ProseMirror node view builds by hand. */
export function moreGlyphElement(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'studio-glyph');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke', 'none');
  for (const cx of [5, 10, 15]) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', '10');
    dot.setAttribute('r', '1.35');
    svg.append(dot);
  }
  return svg;
}
