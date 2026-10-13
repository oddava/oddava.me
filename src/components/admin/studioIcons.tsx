// The workspace's icon set. One 20px grid, one 1.5 stroke, round joins — every
// control glyph in Studio comes from here, so no two buttons draw the same idea
// differently and no text character stands in for an icon.

const PATHS = {
  'chevron-right': <path d="m8 5 5 5-5 5" />,
  'chevron-left': <path d="m12 5-5 5 5 5" />,
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
