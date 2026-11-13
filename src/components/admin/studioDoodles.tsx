// Studio's little drawings: one of its three decorative motifs (see
// _tokens.css). Drawn in the icon stroke from currentColor and tokens, so they
// follow the theme, and always aria-hidden: the words beside them say what
// happened; these only keep them company.
import type { ComponentChildren } from 'preact';

const MARKS = {
  sparkle: (
    <path d="M12 3c.5 4.6 2 6.4 6.6 7-4.6.6-6.1 2.4-6.6 7-.5-4.6-2-6.4-6.6-7 4.6-.6 6.1-2.4 6.6-7z" />
  ),
  leaf: (
    <>
      <path d="M5 19c-.6-8 4.6-13.2 14-14 .4 8.8-4.8 14.2-14 14z" />
      <path d="M5 19c2.4-3.6 5-6.2 8.4-8.4" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c-1.8-2.2-1.2-5 0-6 1.2 1 1.8 3.8 0 6zM13.9 11.4c.9-2.7 3.6-3.6 5.1-3.2-.2 1.5-2.3 3.5-5.1 3.2zM13.2 13.6c2.8.1 4.4 2.4 4.4 4-1.5.3-4-.9-4.4-4zM10.8 13.6c-.4 3.1-2.9 4.3-4.4 4 0-1.6 1.6-3.9 4.4-4zM10.1 11.4c-2.8.3-4.9-1.7-5.1-3.2 1.5-.4 4.2.5 5.1 3.2z" />
    </>
  ),
  heart: (
    <path d="M12 19.5c-4.3-2.9-7-5.7-7-9a3.7 3.7 0 0 1 7-1.7 3.7 3.7 0 0 1 7 1.7c0 3.3-2.7 6.1-7 9z" />
  ),
  squiggle: (
    <path d="M2.5 12c1.6-3 3.2-3 4.8 0s3.2 3 4.8 0 3.2-3 4.8 0 3.2 3 4.6 0" />
  ),
} as const;

export type DoodleName = keyof typeof MARKS;

/** One small mark, the size of the text it sits in unless told otherwise. */
export function Doodle({
  name,
  size = 16,
  className,
}: {
  name: DoodleName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `studio-doodle ${className}` : 'studio-doodle'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {MARKS[name]}
    </svg>
  );
}

function Scene({
  name,
  children,
}: {
  name: string;
  children: ComponentChildren;
}) {
  return (
    <svg
      className="studio-doodle studio-doodle--scene"
      data-doodle={name}
      viewBox="0 0 120 88"
      width="120"
      height="88"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A sheet of paper, taped down, a few lines written. Shared by the scenes. */
function Sheet({ lines = 3 }: { lines?: number }) {
  return (
    <>
      <path
        className="is-paper"
        d="M38 20.5c0-1.9 1.6-3.5 3.5-3.5h37c1.9 0 3.5 1.6 3.5 3.5v49c0 1.9-1.6 3.5-3.5 3.5h-37c-1.9 0-3.5-1.6-3.5-3.5z"
      />
      <path className="is-ink" d="M52 14.5l16-1.5.6 6-16 1.5z" />
      {lines > 0 && <path d="M46 32h18" />}
      {lines > 1 && <path d="M46 41h28" />}
      {lines > 2 && <path d="M46 50h22" />}
    </>
  );
}

const sparkleAt = (x: number, y: number, scale = 1) => (
  <path
    className="is-ink"
    transform={`translate(${x} ${y}) scale(${scale})`}
    d="M0-7c.4 3.8 1.7 5.3 5.5 5.8-3.8.5-5.1 2-5.5 5.8-.4-3.8-1.7-5.3-5.5-5.8 3.8-.5 5.1-2 5.5-5.8z"
  />
);

/** Nothing open: a fresh sheet, a sprig beside it. */
export function DoodleBlankPage() {
  return (
    <Scene name="blank">
      <g transform="rotate(-4 60 45)">
        <Sheet />
      </g>
      {sparkleAt(96, 24)}
      {sparkleAt(104, 40, 0.55)}
      <path d="M22 74c-1-9 2-16 8-21" />
      <path d="M26 62c-5.5.5-9-2-10-6.5 5-.8 8.6 1.3 10 6.5zM28 56c.5-5 3.6-8 8-8.5.5 4.5-2.3 7.8-8 8.5z" />
    </Scene>
  );
}

/** No versions yet: one sheet, and the first copy only an outline behind it. */
export function DoodleFirstCopy() {
  return (
    <Scene name="first-copy">
      <path
        strokeDasharray="2 4"
        d="M47 13.5c0-1.9 1.6-3.5 3.5-3.5h37c1.9 0 3.5 1.6 3.5 3.5v49c0 1.9-1.6 3.5-3.5 3.5"
      />
      <g transform="rotate(-3 60 45)">
        <Sheet lines={2} />
      </g>
      <circle className="is-paper" cx="84" cy="64" r="11" />
      <path d="M84 58v6.5l4 2.5" />
      {sparkleAt(24, 30, 0.8)}
    </Scene>
  );
}

/** Something would not load: the sheet is fine, there is a cloud over it. */
export function DoodleCloudy() {
  return (
    <Scene name="cloudy">
      <g transform="rotate(3 60 50)">
        <Sheet lines={2} />
      </g>
      <path
        className="is-paper"
        d="M78 30h17a6.5 6.5 0 0 0 .8-12.9 9 9 0 0 0-17.3-2.4A7.7 7.7 0 0 0 78 30z"
      />
      <path className="is-warm" d="M81 36l-1.5 4M88 36l-1.5 4M95 36l-1.5 4" />
    </Scene>
  );
}

/** Nothing matches a search: a lens with a flower where the find would be. */
export function DoodleNoMatch() {
  return (
    <Scene name="no-match">
      <circle className="is-paper" cx="54" cy="40" r="20" />
      <path d="M69 55l13 13" />
      <g className="is-ink" transform="translate(42 28)">
        {MARKS.flower}
      </g>
      {sparkleAt(92, 26, 0.8)}
    </Scene>
  );
}

/** An empty garden: a pot with its first sprout. */
export function DoodleSprout() {
  return (
    <Scene name="sprout">
      <path
        className="is-paper"
        d="M44 52h32l-3.5 18.5c-.3 1.5-1.6 2.5-3 2.5h-19c-1.4 0-2.7-1-3-2.5z"
      />
      <path d="M41 52h38" />
      <path className="is-ink" d="M60 52c-.5-9 .5-15 2-21" />
      <path
        className="is-ink"
        d="M61 40c-6.5.5-10.5-2.5-11.5-8 6-.8 10 1.8 11.5 8zM62.5 32c.8-6 4.5-9.5 10-10 .4 5.5-3.2 9.3-10 10z"
      />
      {sparkleAt(90, 30, 0.7)}
    </Scene>
  );
}
