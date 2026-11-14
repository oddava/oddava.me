import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { JSX } from 'preact';
import type { PublicStar, VisitorPulse } from '../../lib/contracts';
import { fetchSky, placeStar, StarError } from './api';
import {
  placedToday,
  readMine,
  rememberMine,
  STARS_PER_DAY,
  type MyStar,
} from './mine';
import { graphemes } from '../../lib/graphemes';
import { createSkyRenderer, MAX_FIREFLIES, type SkyRenderer } from './render';
import { formatCount, onPulse } from '../visitors/pulse';
import { CABIN_X, CAT_X, PINES, pinePath, RIDGES } from './hills';

/** Matches STAR_WORD_MAX_LENGTH on the server. */
const WORD_MAX = 24;
/** How often an open sky looks for stars left since. */
const REFRESH_MS = 45_000;
/** How long a star placed here outlasts reads of the sky that lack it. */
const PLACED_GRACE_MS = 5 * 60_000;
const COMPOSER_WIDTH = 320;
/** The composer's height until it has been measured, for above or below. */
const COMPOSER_HEIGHT = 196;
/** Space kept between the composer and the sky's sides. */
const COMPOSER_INSET = 12;
/** How far the composer sits from its ghost, above or below. */
const COMPOSER_GAP = 26;
/**
 * Below this width (a phone) the page moves to keep the whole composer in
 * view, above the keyboard once it is up.
 */
const NARROW = 560;
/** Room kept between the composer and the edge of what can be seen. */
const VIEW_MARGIN = 12;
const TIP_GAP = 16;
/** Half the label's widest, so it never runs off either edge. */
const TIP_HALF = 132;
/** Space kept between the stars and the sky's edges and its ground. */
const FIELD_MARGIN = 14;
/** How long a hovered label waits for the pointer to reach it. */
const LABEL_LINGER_MS = 280;
/** How far each hill layer reaches past the sky's sides, for the tilt. */
const LAND_BLEED = 18;
/** How long "your star is up" stays before the line settles back. */
const NOTICE_MS = 7000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const MONTH = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

/** "just now", "3 hours ago", "yesterday", "in march 2026". */
export function whenLeft(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600)
    return RELATIVE.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400)
    return RELATIVE.format(-Math.round(seconds / 3600), 'hour');
  const days = Math.round(seconds / 86400);
  if (days < 30) return RELATIVE.format(-days, 'day');
  return `in ${MONTH.format(then).toLowerCase()}`;
}

/** "#8db1ff" or "rgb(141 177 255)" to "141, 177, 255", for the canvas. */
export function toRgbTriplet(color: string): string | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits =
      hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    return [0, 2, 4]
      .map((i) => parseInt(digits.slice(i, i + 2), 16))
      .join(', ');
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  return rgb ? `${rgb[1]}, ${rgb[2]}, ${rgb[3]}` : null;
}

const CLOCK = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});

/** "tomorrow", "at 5:00 am": when a day's stars come back, in local time. */
function until(at: number, now = Date.now()): string {
  const hours = (at - now) / 3_600_000;
  if (hours > 12) return 'tomorrow';
  return `at ${CLOCK.format(at).toLowerCase()}`;
}

/** The emptiest of a handful of random spots, for "leave a star". */
function openSpot(
  stars: PublicStar[],
  project: (point: { x: number; y: number }) => { x: number; y: number },
  blocked: (x: number, y: number) => boolean = () => false,
) {
  const placed = stars.map(project);
  let best = { x: 0.5, y: 0.5 };
  let bestGap = -1;
  for (let i = 0; i < 64; i++) {
    const point = {
      x: 0.06 + Math.random() * 0.88,
      y: 0.06 + Math.random() * 0.88,
    };
    const { x, y } = project(point);
    if (blocked(x, y)) continue;
    let gap = Infinity;
    for (const s of placed) gap = Math.min(gap, Math.hypot(s.x - x, s.y - y));
    if (gap > bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  return best;
}

export default function SkyField() {
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const landRef = useRef<HTMLDivElement>(null);
  const napRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const renderer = useRef<SkyRenderer | null>(null);

  const [stars, setStars] = useState<PublicStar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [writable, setWritable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState<MyStar[]>([]);
  const [pulse, setPulse] = useState<VisitorPulse | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  /** The open composer's height, measured: an error line makes it taller. */
  const [composerH, setComposerH] = useState(COMPOSER_HEIGHT);
  const [word, setWord] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [coarse, setCoarse] = useState(false);
  /** The sky has focus from the keyboard: ring the chosen star. */
  const [keyFocus, setKeyFocus] = useState(false);
  /** A star just placed is on its way up: the sky is busy, not idle. */
  const [rising, setRising] = useState(false);
  /** Bumped on resize, so the overlays re-read star positions. */
  const [, setLayout] = useState(0);
  /**
   * The land's cabin, pines and cat are placed by script once the island is
   * up: inline style in the prerendered HTML would break the page's CSP.
   */
  const [mounted, setMounted] = useState(false);

  const mineById = useMemo(
    () => new Map(mine.map((star) => [star.id, star])),
    [mine],
  );

  // ---- the canvases ---------------------------------------------------
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !backRef.current || !frontRef.current) return;
    const sky = createSkyRenderer(
      backRef.current,
      frontRef.current,
      prefersReducedMotion,
    );
    renderer.current = sky;
    setMine(readMine());
    setCoarse(window.matchMedia('(pointer: coarse)').matches);

    /**
     * The stars' field: from the top of the sky down to just above the
     * farthest hills' highest peak. A new star rises from the nearest
     * ridge below it; the fireflies keep to the hills.
     */
    const measure = () => {
      const land = landRef.current;
      const h = panel.clientHeight;
      const w = panel.clientWidth;
      const landTop = land?.offsetTop ?? h;
      const landH = land?.offsetHeight ?? 0;
      const peak = landTop + RIDGES.far.peak * landH;
      // Inside the fades. Each theme's stylesheet says, as plain fractions
      // of the sky, where its fade has fully come in at the top and sides.
      const style = getComputedStyle(panel);
      const top = parseFloat(style.getPropertyValue('--sky-field-top')) || 0.2;
      const side =
        parseFloat(style.getPropertyValue('--sky-field-side')) || 0.1;
      sky.setField(h * top, peak - FIELD_MARGIN, w * side);
      // The near layer overhangs both sides by LAND_BLEED for the parallax.
      sky.setGround(
        (x) =>
          landTop +
          RIDGES.near.at((x + LAND_BLEED) / (w + LAND_BLEED * 2)) * landH,
        [peak / h, 0.97],
      );
      setLayout((n) => n + 1);
    };

    /** The site's ink (its night variant) lights the sky's own touches. */
    const readAccent = () => {
      const style = getComputedStyle(panel);
      sky.setPalette(style.colorScheme.includes('dark') ? 'dark' : 'light');
      const accent = toRgbTriplet(style.getPropertyValue('--sky-accent'));
      if (accent) sky.setAccent(accent);
      // The two themes fade differently, so the field moves with them.
      measure();
    };

    readAccent();

    /**
     * 100vw counts a scrollbar and its reserved gutter; the page's column is
     * centred on the body, which does not. The sky takes the body's width.
     */
    const fitWidth = () => {
      const bar = window.innerWidth - document.body.clientWidth;
      panel.style.setProperty('--scrollbar', `${Math.max(0, bar)}px`);
    };
    fitWidth();

    let timer = 0;
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        fitWidth();
        sky.resize();
        measure();
      }, 100);
    };
    const watchSize = new ResizeObserver(onResize);
    watchSize.observe(panel);
    // The appearance panel changes the ink and theme on <html> in place.
    const watchInk = new MutationObserver(readAccent);
    watchInk.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ink', 'data-theme'],
    });
    // "system" follows the device, which can change under an open page.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', readAccent);

    // The cat, asleep on the horizon: painted once, after the stars.
    const nap = napRef.current;
    if (nap) {
      void import('../../lib/awake/quiet').then(({ paintNap }) => {
        paintNap(nap);
        nap.classList.add('is-painted');
      });
    }

    setMounted(true);

    return () => {
      clearTimeout(timer);
      watchSize.disconnect();
      watchInk.disconnect();
      scheme.removeEventListener('change', readAccent);
      sky.destroy();
      renderer.current = null;
    };
  }, []);

  // ---- data -----------------------------------------------------------
  /**
   * Stars placed from this page, kept in view until a read of the sky
   * includes them: the sky is shared from a short cache, so the next read
   * can predate a star placed a moment ago.
   */
  const placed = useRef(new Map<string, { star: PublicStar; at: number }>());
  /** Bumped per read, and by a placed star: only the newest read lands. */
  const loadSeq = useRef(0);
  /** Whether the next star list is a refresh (new ones fade in). */
  const refreshing = useRef(false);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = await fetchSky();
      if (seq !== loadSeq.current) return;
      const seen = new Set(next.stars.map((star) => star.id));
      const kept: PublicStar[] = [];
      for (const [id, { star, at }] of placed.current) {
        if (seen.has(id) || Date.now() - at > PLACED_GRACE_MS) {
          placed.current.delete(id);
        } else kept.push(star);
      }
      setStars([...kept, ...next.stars]);
      setWritable(next.writable);
      setLoadError(false);
    } catch {
      if (seq === loadSeq.current) setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      refreshing.current = true;
      void load();
    };
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => onPulse(setPulse), []);

  useEffect(() => {
    renderer.current?.setStars(
      stars.map((star) => ({
        id: star.id,
        x: star.x,
        y: star.y,
        // Your own word shows to you before it is read.
        word: star.word ?? mineById.get(star.id)?.word,
        mine: mineById.has(star.id),
      })),
      { animateNew: refreshing.current },
    );
    refreshing.current = false;
  }, [stars, mineById]);

  useEffect(() => {
    renderer.current?.setHover(active);
  }, [active]);

  useEffect(() => {
    renderer.current?.setGhost(ghost);
  }, [ghost]);

  useEffect(() => {
    renderer.current?.setFocusRing(keyFocus);
  }, [keyFocus]);

  // Everyone else here now drifts through the sky as a wandering light.
  useEffect(() => {
    renderer.current?.setCompany(Math.max(0, (pulse?.here ?? 1) - 1));
  }, [pulse?.here]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---- placing --------------------------------------------------------
  const size = renderer.current?.size() ?? { w: 0, h: 0 };
  const narrow = size.w > 0 && size.w < NARROW;
  const open = ghost !== null;

  useEffect(() => {
    const form = composerRef.current;
    if (!open || !form) return;
    const watch = new ResizeObserver(() => {
      if (form.offsetHeight > 0) setComposerH(form.offsetHeight);
    });
    watch.observe(form);
    return () => watch.disconnect();
  }, [open]);

  /**
   * On a phone the composer floats on the sky by its ghost, as on a wide
   * screen, and the page moves just enough to show all of it (and the
   * ghost, when both fit) in what can be seen: once it opens, and again
   * whenever the keyboard comes up or goes down, which shrinks the visual
   * viewport, not the page.
   */
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const keepComposerInView = useCallback((smooth: boolean) => {
    const form = composerRef.current;
    if (!form) return;
    const view = window.visualViewport;
    const viewTop = (view?.offsetTop ?? 0) + VIEW_MARGIN;
    const viewBottom =
      (view?.offsetTop ?? 0) +
      (view?.height ?? window.innerHeight) -
      VIEW_MARGIN;
    const box = form.getBoundingClientRect();
    let top = box.top;
    let bottom = box.bottom;
    const ghostAt = ghostRef.current
      ? renderer.current?.project(ghostRef.current)
      : null;
    const sky = surfaceRef.current?.getBoundingClientRect();
    if (ghostAt && sky) {
      const ghostY = sky.top + ghostAt.y;
      const withGhostTop = Math.min(top, ghostY - VIEW_MARGIN);
      const withGhostBottom = Math.max(bottom, ghostY + VIEW_MARGIN);
      if (withGhostBottom - withGhostTop <= viewBottom - viewTop) {
        top = withGhostTop;
        bottom = withGhostBottom;
      }
    }
    // The bottom first (the keyboard covers it), but never past the top.
    let delta = 0;
    if (bottom > viewBottom) delta = bottom - viewBottom;
    if (top - delta < viewTop) delta = top - viewTop;
    if (Math.abs(delta) < 1) return;
    window.scrollBy({
      top: delta,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, []);

  // The keyboard coming up or going down.
  useEffect(() => {
    const view = window.visualViewport;
    if (!open || !narrow || !view) return;
    let frame = 0;
    const onViewResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => keepComposerInView(false));
    };
    view.addEventListener('resize', onViewResize);
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener('resize', onViewResize);
    };
  }, [open, narrow, keepComposerInView]);

  // Opened, moved ("somewhere else", a tap elsewhere on the sky), or grown
  // (an error line): show all of it.
  useEffect(() => {
    if (!ghost || !narrow) return;
    const frame = requestAnimationFrame(() => keepComposerInView(true));
    return () => cancelAnimationFrame(frame);
  }, [ghost, composerH, narrow, keepComposerInView]);

  const openComposer = (point: { x: number; y: number }) => {
    setGhost(point);
    setActive(null);
    setPinned(false);
    setFormError(null);
    setNotice(null);
    // Focus once the composer is in.
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const closeComposer = (returnFocus = true) => {
    setGhost(null);
    setWord('');
    setFormError(null);
    if (returnFocus) {
      const back = opener.current?.isConnected
        ? opener.current
        : surfaceRef.current;
      // The "leave a star" button is disabled while the composer is open,
      // and a disabled button cannot take focus: wait for the render that
      // enables it.
      requestAnimationFrame(() =>
        window.setTimeout(() => {
          const target =
            back && !(back as HTMLButtonElement).disabled
              ? back
              : surfaceRef.current;
          target?.focus({ preventScroll: true });
        }, 0),
      );
    }
    opener.current = null;
  };

  const spotFor = () =>
    renderer.current
      ? openSpot(stars, renderer.current.project, renderer.current.onMoon)
      : { x: 0.5, y: 0.5 };

  /** Your stars today, as the server counts them (a guide; it decides). */
  const today = placedToday(mine);
  const outOfStars = today.count >= STARS_PER_DAY;
  const outMessage = `that's ${STARS_PER_DAY} stars today. the sky saves you a spot ${until(today.resetsAt)}.`;

  /** Where focus goes when the composer closes: whatever opened it. */
  const opener = useRef<HTMLElement | null>(null);

  const leaveStar = (event?: Event) => {
    if (outOfStars) {
      setNotice(outMessage);
      setAnnounce(outMessage);
      return;
    }
    opener.current = (event?.currentTarget as HTMLElement | null) ?? null;
    openComposer(spotFor());
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!ghost || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const trimmed = word.trim();
    try {
      const { star, wordPending } = await placeStar({
        x: ghost.x,
        y: ghost.y,
        word: trimmed,
      });
      setMine(
        rememberMine({
          id: star.id,
          at: Date.now(),
          ...(trimmed ? { word: trimmed } : {}),
        }),
      );
      opener.current = null;
      placed.current.set(star.id, { star, at: Date.now() });
      // A read that started before this star may land after it; drop it.
      loadSeq.current += 1;
      setStars((current) => [star, ...current.filter((s) => s.id !== star.id)]);
      setGhost(null);
      setWord('');
      // Land it once the renderer has it.
      requestAnimationFrame(() => renderer.current?.land(star.id));
      const message = wordPending
        ? 'your star is up. its word shows to everyone once it has been read.'
        : 'your star is up.';
      setNotice(message);
      setAnnounce(message);
      setRising(true);
      window.setTimeout(
        () => {
          setRising(false);
          setActive(star.id);
          setPinned(true);
        },
        prefersReducedMotion() ? 0 : 1600,
      );
      surfaceRef.current?.focus({ preventScroll: true });
    } catch (error) {
      const message =
        error instanceof StarError
          ? error.message
          : 'could not place your star.';
      setFormError(message);
      setAnnounce(message);
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      // Back to the word, so the keyboard can try again or change it.
      requestAnimationFrame(() =>
        inputRef.current?.focus({ preventScroll: true }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ---- pointer and keys ----------------------------------------------
  const pointFrom = (event: PointerEvent | MouseEvent) => {
    const box = surfaceRef.current?.getBoundingClientRect();
    const px = event.clientX - (box?.left ?? 0);
    const py = event.clientY - (box?.top ?? 0);
    // Null outside the field: the ground, the very edge.
    return { px, py, sky: renderer.current?.unproject(px, py) ?? null };
  };

  /**
   * How near a tap must land to pick a star rather than place one. A
   * fingertip gets more room on an empty sky, and less as it fills, so
   * there is always open sky to tap.
   */
  const reachFor = () => {
    if (!coarse) return 14;
    const { w, h } = renderer.current?.size() ?? { w: 1, h: 1 };
    const spacing = Math.sqrt((w * h) / Math.max(1, stars.length));
    return Math.min(24, Math.max(10, spacing * 0.4));
  };

  /**
   * A hovered label stays a moment after the pointer leaves its star, long
   * enough to move onto the label and read it; leaving the label closes it.
   */
  const hideTimer = useRef(0);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const holdLabel = () => clearTimeout(hideTimer.current);
  const releaseLabel = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setActive((current) => (pinnedRef.current ? current : null));
    }, LABEL_LINGER_MS);
  };

  /** The hills lean a little away from the pointer, nearest the most. */
  const tilt = (px: number) => {
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion()) return;
    const k = (px / Math.max(1, panel.clientWidth)) * 2 - 1;
    panel.style.setProperty('--tilt', k.toFixed(3));
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const { px, py } = pointFrom(event);
    tilt(px);
    renderer.current?.setPointer({ x: px, y: py });
    if (pinned) return;
    const id = renderer.current?.hit(px, py, reachFor()) ?? null;
    const surface = surfaceRef.current;
    if (surface) surface.dataset.over = id ? 'star' : '';
    if (id) {
      holdLabel();
      setActive(id);
    } else if (active) releaseLabel();
  };

  const onPointerLeave = () => {
    renderer.current?.setPointer(null);
    panelRef.current?.style.setProperty('--tilt', '0');
    if (!pinned && active) releaseLabel();
  };

  // Escape closes a label from anywhere on the page, not only once the sky
  // has focus. The composer handles its own Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || ghost || !active) return;
      setActive(null);
      setPinned(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [active, ghost]);

  const closeLabel = () => {
    clearTimeout(hideTimer.current);
    setActive(null);
    setPinned(false);
  };

  // So does a click or tap anywhere off the sky: the page, the bar, the
  // header. On the sky, `onClick` decides (another star opens its label;
  // open sky closes this one), and the label closes on its own click (see
  // the tip): closed on pointerdown, it would be gone before the click,
  // and a tap's click would land on the sky under it and start a star.
  // Pointerdown, not click, for the rest: Safari on iOS sends the document
  // no click for a tap on plain text.
  useEffect(() => {
    if (!active || ghost) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (surfaceRef.current?.contains(target) || target.closest('.sky-tip'))
      ) {
        return;
      }
      closeLabel();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active, ghost]);

  const onClick = (event: MouseEvent) => {
    if (event.target !== surfaceRef.current) return;
    const point = pointFrom(event);
    const id = renderer.current?.hit(point.px, point.py, reachFor()) ?? null;
    if (id) {
      setActive(id);
      setPinned(true);
      setNotice(null);
      return;
    }
    if (pinned && active && !ghost) {
      // A first tap away from an open label just closes it.
      setActive(null);
      setPinned(false);
      return;
    }
    if (writable && point.sky && outOfStars) {
      setNotice(outMessage);
      setAnnounce(outMessage);
    } else if (writable && point.sky) {
      opener.current = surfaceRef.current;
      openComposer(point.sky);
    } else {
      setActive(null);
      setPinned(false);
    }
  };

  /** Stars in reading order, for the arrow keys. */
  const order = useMemo(
    () => [...stars].sort((a, b) => a.x - b.x || a.y - b.y),
    [stars],
  );

  const labelFor = useCallback(
    (star: PublicStar) => {
      const shown = star.word ?? mineById.get(star.id)?.word;
      return shown ? `“${shown}”` : 'a quiet star';
    },
    [mineById],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (ghost) closeComposer();
      else {
        setActive(null);
        setPinned(false);
      }
      return;
    }
    if (event.target !== surfaceRef.current) return;
    if (event.key === 'Enter' && writable) {
      event.preventDefault();
      leaveStar(event);
      return;
    }
    if (order.length === 0) return;
    const index = active ? order.findIndex((s) => s.id === active) : -1;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % order.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = index <= 0 ? order.length - 1 : index - 1;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setKeyFocus(true);
    const star = order[next]!;
    setActive(star.id);
    setPinned(true);
    setAnnounce(
      `${labelFor(star)}, left ${whenLeft(star.createdAt)}. ${next + 1} of ${order.length}.`,
    );
  };

  // ---- overlays -------------------------------------------------------
  const activeStar = active ? stars.find((s) => s.id === active) : undefined;
  const activePos = active ? renderer.current?.position(active) : null;
  // Above its star, unless that would run off the top of the sky.
  const tipBelow = activePos ? activePos.y < 92 : false;
  const ghostPos =
    ghost && renderer.current ? renderer.current.project(ghost) : null;

  // On the sky beside the ghost: above it when there is room, else below;
  // when neither fits (a short sky on a phone), whichever side has more.
  // On a phone it spans the sky less an inset each side: wider is shorter
  // (the hint keeps to one line), so it more often fits beside the ghost.
  const composerW = narrow
    ? size.w - COMPOSER_INSET * 2
    : Math.min(COMPOSER_WIDTH, size.w - COMPOSER_INSET * 2);
  const roomAbove = ghostPos ? ghostPos.y - COMPOSER_GAP - 8 : 0;
  const roomBelow = ghostPos ? size.h - ghostPos.y - COMPOSER_GAP - 8 : 0;
  const composerAbove =
    ghostPos !== null &&
    (roomAbove >= composerH ||
      (roomBelow < composerH && roomAbove > roomBelow));
  const composerStyle: JSX.CSSProperties | undefined = ghostPos
    ? {
        left: `${Math.min(
          Math.max(COMPOSER_INSET, ghostPos.x - composerW / 2),
          size.w - composerW - COMPOSER_INSET,
        )}px`,
        top: `${ghostPos.y + (composerAbove ? -COMPOSER_GAP : COMPOSER_GAP)}px`,
        transform: composerAbove ? 'translateY(-100%)' : undefined,
        width: narrow ? `${composerW}px` : undefined,
      }
    : undefined;

  const count = stars.length;
  const lede = !loaded
    ? 'the stars are coming out…'
    : loadError
      ? 'the sky is behind clouds right now. try again in a little while.'
      : count === 0
        ? 'no stars yet. the first one could be yours.'
        : count === 1
          ? 'one star so far, left by someone passing through.'
          : `${formatCount(count)} stars so far, each left by someone passing through.`;
  const verb = coarse ? 'tap' : 'click';
  /** Everyone else here now: one firefly each. */
  const company = Math.max(0, (pulse?.here ?? 1) - 1);

  const words = useMemo(
    () => stars.filter((s) => s.word).slice(0, 100),
    [stars],
  );

  const composer = ghost && (
    <form
      ref={composerRef}
      class={`sky-composer ${shake ? 'is-shaking' : ''}`}
      style={composerStyle}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeComposer();
        }
      }}
      aria-label="leave a star"
    >
      <div class="sky-composer__head">
        <label class="sky-composer__label" for="sky-word">
          a word for your star <span>(if you like)</span>
        </label>
        <button
          type="button"
          class="sky-icon-btn"
          onClick={() => closeComposer()}
          aria-label="never mind"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div class="sky-composer__field">
        <input
          ref={inputRef}
          id="sky-word"
          class="sky-composer__input"
          value={word}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="hello, a name, a wish…"
          // Read-only while it sends, not disabled: a disabled field drops
          // focus to the page, and an error would leave the keyboard lost.
          readOnly={submitting}
          aria-busy={submitting}
          onInput={(event) => {
            // Counted as a person counts: an emoji, flags and joined ones
            // included, is one, never cut in half.
            const chars = graphemes(event.currentTarget.value);
            const next = chars.slice(0, WORD_MAX).join('');
            if (next !== event.currentTarget.value) {
              event.currentTarget.value = next;
            }
            setWord(next);
          }}
          aria-describedby="sky-word-hint"
        />
        <span class="sky-composer__count" aria-hidden="true">
          {WORD_MAX - graphemes(word).length}
        </span>
      </div>
      {formError && (
        <p class="sky-composer__error" role="alert">
          {formError}
        </p>
      )}
      <div class="sky-composer__actions">
        <button
          type="submit"
          class="sky-btn sky-btn--primary"
          aria-disabled={submitting}
        >
          {submitting ? 'placing…' : 'place star'}
        </button>
        <button
          type="button"
          class="sky-btn sky-btn--quiet"
          onClick={() => {
            setGhost(spotFor());
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          somewhere else
        </button>
      </div>
      <p id="sky-word-hint" class="sky-composer__hint">
        stars stay, and so do their words.
      </p>
    </form>
  );

  return (
    <div class="sky-page">
      <p class="sky-lede">
        {lede}
        {loaded && !loadError && writable && (
          <> {verb} anywhere in the sky to leave yours.</>
        )}
      </p>

      <div ref={panelRef} class="sky">
        {/* The scene fades into the page at its edges; what you touch
            (the surface, the label, the composer) sits above it, unfaded. */}
        <div class="sky-scene" aria-hidden="true">
          <canvas ref={backRef} class="sky-back" />
          <Land landRef={landRef} napRef={napRef} placed={mounted} />
          <canvas ref={frontRef} class="sky-front" />
        </div>

        <div
          ref={surfaceRef}
          class={`sky-surface ${writable ? 'is-writable' : ''}`}
          tabIndex={0}
          // An application: in a screen reader's browse mode, the arrow keys
          // and Enter then reach the sky instead of moving the reading point.
          role="application"
          aria-roledescription="sky"
          aria-label={`the sky, ${count} ${count === 1 ? 'star' : 'stars'}. arrow keys visit them${
            writable ? ', enter leaves yours' : ''
          }.`}
          // Something is being looked at (or is rising): no idle focus frame.
          data-active={active || rising ? '' : undefined}
          onFocus={(event) =>
            setKeyFocus(event.currentTarget.matches(':focus-visible'))
          }
          onBlur={() => setKeyFocus(false)}
          onPointerDown={() => setKeyFocus(false)}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />

        {activeStar && activePos && (
          <div
            class={`sky-tip ${tipBelow ? 'is-below' : ''}`}
            style={{
              left: `${Math.min(Math.max(activePos.x, TIP_HALF), size.w - TIP_HALF)}px`,
              top: `${activePos.y + (tipBelow ? TIP_GAP : -TIP_GAP)}px`,
            }}
            aria-hidden="true"
            onPointerEnter={holdLabel}
            onPointerLeave={() => {
              if (!pinned) releaseLabel();
            }}
            onClick={closeLabel}
          >
            <StarLabel star={activeStar} own={mineById.get(activeStar.id)} />
          </div>
        )}

        {composer}
      </div>

      <div class="sky-bar">
        {writable && (
          <button
            type="button"
            class="sky-btn sky-btn--primary sky-btn--leave"
            onClick={(event) => leaveStar(event)}
            disabled={Boolean(ghost)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M8 1.5c.4 3.4 1.6 4.8 5 5.5-3.4.7-4.6 2.1-5 5.5-.4-3.4-1.6-4.8-5-5.5 3.4-.7 4.6-2.1 5-5.5Z" />
            </svg>
            leave a star
          </button>
        )}
        <p class={`sky-bar__note ${notice ? 'is-notice' : ''}`}>
          {notice ??
            (company > 0
              ? company === 1
                ? 'the firefly is someone else here right now.'
                : company > MAX_FIREFLIES
                  ? 'the fireflies are the others here right now.'
                  : `the ${formatCount(company)} fireflies are the others here right now.`
              : mine.length > 0
                ? 'yours are ringed in the sky.'
                : 'stars stay, and so do their words.')}
        </p>
      </div>

      {words.length > 0 && (
        <section class="sr-only" aria-label="words in the sky">
          <ul>
            {words.map((star) => (
              <li key={star.id}>
                “{star.word}”, left {whenLeft(star.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p class="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

/** A star's word (or that it has none) and when it was left: nothing more. */
function StarLabel({ star, own }: { star: PublicStar; own?: MyStar }) {
  const shown = star.word ?? own?.word;
  return (
    <>
      <p class={`sky-tip__word ${shown ? '' : 'is-quiet'}`}>
        {shown ? `“${shown}”` : 'a quiet star'}
      </p>
      <p class="sky-tip__when">left {whenLeft(star.createdAt)}</p>
    </>
  );
}

/**
 * The hills: three ridges, far to near, with a cabin on the middle one and
 * pines and the sleeping cat on the nearest. The ridges are drawn from fixed
 * curves, the same for everyone; the little things on them are placed once
 * the island is up (see `placed`).
 */
function Land({
  landRef,
  napRef,
  placed,
}: {
  landRef: { current: HTMLDivElement | null };
  napRef: { current: HTMLCanvasElement | null };
  placed: boolean;
}) {
  const on = (ridge: keyof typeof RIDGES, x: number) => ({
    left: `${x * 100}%`,
    top: `${RIDGES[ridge].at(x) * 100}%`,
  });
  return (
    <div ref={landRef} class="sky-land" aria-hidden="true">
      <div class="sky-layer sky-layer--far">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <path d={RIDGES.far.path} />
        </svg>
      </div>
      <div class="sky-mist" />
      <div class="sky-layer sky-layer--mid">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <path d={RIDGES.mid.path} />
        </svg>
        {placed && (
          <svg
            class="sky-cabin"
            viewBox="0 0 40 34"
            width="40"
            height="34"
            style={on('mid', CABIN_X)}
          >
            <path
              class="sky-cabin__house"
              d="M4 16 L20 4 L36 16 L33 16 L33 34 L7 34 L7 16 Z"
            />
            <rect
              class="sky-cabin__chimney"
              x="26"
              y="6"
              width="4"
              height="8"
            />
            <rect
              class="sky-cabin__window"
              x="13"
              y="20"
              width="7"
              height="7"
              rx="1"
            />
            <rect
              class="sky-cabin__window"
              x="22"
              y="20"
              width="5"
              height="14"
              rx="1"
            />
          </svg>
        )}
      </div>
      <div class="sky-layer sky-layer--near">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <path d={RIDGES.near.path} />
        </svg>
        {placed &&
          PINES.map(([x, height]) => (
            <svg
              key={x}
              class="sky-pine"
              viewBox="0 0 40 60"
              style={{
                ...on('near', x),
                height: `${height * 100}%`,
              }}
            >
              <path d={pinePath(20, 60, 60)} />
            </svg>
          ))}
        <canvas
          ref={napRef}
          class="sky-nap"
          style={placed ? on('near', CAT_X) : undefined}
        />
      </div>
    </div>
  );
}
