import {
  CatBody,
  type Goal,
  type Rest,
  type Surface,
  type SurfaceId,
} from './body';
import {
  drawCat,
  drawPlatform,
  restingFace,
  type Face,
  type Platform,
} from './draw';
import {
  bubbleAlive,
  drawBubble,
  makeBubble,
  type Bubble,
  type Saying,
} from './bubble';
import { dartScore, gazeOffset, nearerEar, type Sample } from './gaze';
import { CatLife, type Expression } from './life';
import { CatMind, type MindEvent, type MindOutput } from './mind';
import { skeleton, type BodyState, type Skeleton, type Vec } from './rig';
import { createSky } from './sky';
import { bump, clamp } from './spring';

/**
 * Wires the cat to the page. The cat lives on a canvas behind the type, at
 * home on a hairline along the bottom of its world (the hero band on home,
 * the screen on the status pages), and goes anywhere else on platforms of
 * light it conjures as it lands. Each frame it picks one goal, in priority
 * order: a header page it was asked about (hover, focus), a spot it leapt or
 * was dropped to, or whatever it felt like doing next — wander, sit, loaf, a
 * visit to the name. Shake the cursor and it leaps at it; grab it and it
 * dangles. The mind (moods, blinks, the slow-blink exchange), the body
 * (walking, jumping) and its life between (habits, ears, tail) are
 * pure; this file is the glue.
 */

type Interest = { kind: 'nav'; el: HTMLAnchorElement };

const NAV_LINGER = 2600;
/** How long it stays up on a platform with nothing going on. */
const PLATFORM_STAY = 6500;
const LEAP_COOLDOWN = 1100;
const ZEES = [
  ['z', 13],
  ['z', 17],
  ['Z', 22],
] as const;

function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const inside = (sk: Skeleton, x: number, y: number, pad = 0) =>
  x >= sk.box.x0 - pad &&
  x <= sk.box.x1 + pad &&
  y >= sk.box.y0 - pad &&
  y <= sk.box.y1 + pad;

export function mountAwake(root: HTMLElement) {
  const $ = <T extends Element>(selector: string) =>
    document.querySelector<T>(selector);
  const catCanvas = $<HTMLCanvasElement>('[data-awake-cat]');
  const skyCanvas = $<HTMLCanvasElement>('[data-awake-sky-canvas]');
  const fxCanvas = $<HTMLCanvasElement>('[data-awake-fx]');
  const perchEl = $<HTMLElement>('[data-awake-perch]');
  const groundEl = $<HTMLElement>('[data-awake-ground]');
  const petButton = $<HTMLButtonElement>('[data-awake-pet]');
  if (!catCanvas || !skyCanvas || !fxCanvas || !perchEl || !groundEl) return;
  const navLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>('[data-home-nav]'),
  ];
  const dimEl = $<HTMLElement>('[data-awake-dim]');
  const live = $<HTMLElement>('[data-awake-live]');
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const now = () => performance.now();

  // The cat's world. On home it is a band at the top of the page — the header
  // and the hero, ending on the floor — that scrolls away with them; on the
  // status pages it is the whole screen. Every coordinate below is local to
  // it, so scrolling the page never moves a surface.
  const band = $<HTMLElement>('[data-awake-band]');
  let onScreen = true;
  function fitBand() {
    if (!band) return;
    const bottom =
      root.getBoundingClientRect().bottom - band.getBoundingClientRect().top;
    band.style.height = `${Math.round(bottom)}px`;
  }
  const frameBox = () =>
    band?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  fitBand();
  let { width, height } = frameBox();
  /** A client point in the band's coordinates. */
  const local = (x: number, y: number): Vec => {
    const b = frameBox();
    return [x - b.left, y - b.top];
  };

  const sky = createSky(skyCanvas, fxCanvas);
  let ctx = fit(catCanvas, width, height);

  // ---------- measuring the page ----------

  let scale = 1;
  let home = 0;
  let navAt = new Map<HTMLAnchorElement, Vec>();
  let surfaces: Record<SurfaceId, Surface> = {
    perch: { x0: 0, x1: 0, y: 0 },
    ground: { x0: 0, x1: 0, y: 0 },
  };
  const platforms = new Map<string, Platform>();
  let platformCount = 0;
  const measureCanvas = document.createElement('canvas').getContext('2d')!;

  function measure() {
    scale =
      parseFloat(
        getComputedStyle(root).getPropertyValue('--awake-cat-scale'),
      ) || 1;
    // The perch is the ink top of the name, so the paws rest on the letters.
    const text = [...perchEl!.childNodes].find(
      (n): n is Text =>
        n.nodeType === Node.TEXT_NODE && /\S/.test((n as Text).data),
    );
    const style = getComputedStyle(perchEl!);
    const range = document.createRange();
    // Client boxes, moved into the band's coordinates.
    const frame = frameBox();
    const at = (r: DOMRect) =>
      new DOMRect(r.left - frame.left, r.top - frame.top, r.width, r.height);
    let wordBox = at(perchEl!.getBoundingClientRect());
    let restX = wordBox.left + wordBox.width / 2;
    let inkTop = wordBox.top + wordBox.height * 0.2;
    if (text) {
      const start = text.data.search(/\S/);
      const word = text.data.trim();
      range.setStart(text, start);
      range.setEnd(text, start + word.length);
      wordBox = at(range.getBoundingClientRect());
      // Sit on the tall letters ("dd"), where the ascenders give a ledge.
      const tall = word.indexOf('dd');
      if (tall >= 0) {
        range.setStart(text, start + tall);
        range.setEnd(text, start + tall + 2);
        const box = at(range.getBoundingClientRect());
        restX = box.left + box.width / 2;
        measureCanvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const m = measureCanvas.measureText('dd');
        const offset =
          m.fontBoundingBoxAscent && m.actualBoundingBoxAscent
            ? m.fontBoundingBoxAscent - m.actualBoundingBoxAscent
            : box.height * 0.18;
        inkTop = box.top + offset;
      }
    }
    range.detach();
    home = restX;
    surfaces = {
      perch: { x0: wordBox.left - 6, x1: wordBox.right + 6, y: inkTop + 1.5 },
      // Inset so a cat at the end still has room for its whiskers.
      ground: {
        x0: 4 + 30 * scale,
        x1: width - 4 - 30 * scale,
        y: at(groundEl!.getBoundingClientRect()).top + 0.5,
      },
    };
    // A resize must not strand the cat on a platform now off screen.
    const floor = surfaces.ground.y - 70 * scale;
    for (const [id, p] of platforms) {
      const half = (p.x1 - p.x0) / 2;
      const cx = Math.min(
        width - half - 6,
        Math.max(half + 6, (p.x0 + p.x1) / 2),
      );
      p.x0 = cx - half;
      p.x1 = cx + half;
      p.y = Math.max(150 * scale, Math.min(floor, p.y));
      surfaces[id] = p;
    }
    navAt = new Map(
      navLinks.map((link) => {
        const r = at(link.getBoundingClientRect());
        return [link, [r.left + r.width / 2, r.top + r.height / 2]];
      }),
    );
  }

  measure();
  const reduced = () => reducedQuery.matches;
  const mind = new CatMind(now());
  const life = new CatLife(now());
  const body = new CatBody(
    surfaces,
    {
      surface: 'ground',
      x: width * 0.3,
      pose: reduced() ? 'sit' : 'loaf',
    },
    scale,
  );

  // ---------- input ----------

  let pointer: (Vec & { t: number }) | null = null;
  const samples: Sample[] = [];
  let lastInput = now();
  let engaged = false;
  let interest: Interest | null = null;
  let interestUntil = 0;
  let navTarget: HTMLAnchorElement | null = null;
  let navUntil = 0;
  /** Where it was sent (shake, tap, pspsps, a drop) and until when. */
  let sent: { surface: SurfaceId; x: number; until: number } | null = null;
  let lastLeap = -Infinity;
  let drag: { x: number; y: number; on: boolean } | null = null;
  /** What it decided to do on its own, and until when. */
  let whim: {
    rest: Rest;
    surface: SurfaceId;
    x: number;
    until: number;
  } | null = null;
  let tiltUntil = 0;
  let typed = '';
  let petFocus = false;
  let lastSkeleton: Skeleton | null = null;
  let hoverCat = false;
  /** Set when let go, cleared when it lands. */
  let droppedAt = 0;
  /** Raised above the page's text while carried and falling. */
  let lifted = false;
  /** Pointer travel over the cat lately — a stroke, not prey. */
  let strokeTravel = 0;
  let strokeAt = -Infinity;
  let strokePurred = false;

  function stir() {
    const t = now();
    // Back after a long quiet: a little hello.
    if (
      t - lastInput > 20000 &&
      mind.phase === 'awake' &&
      Math.random() < 0.6
    ) {
      life.trigger('meow', t, 350);
      greeting = true;
    }
    lastInput = t;
    engaged = true;
    if (mind.stir(t)) run();
  }

  /** Redraw after an input: the loop when moving, one still frame if not. */
  function refresh() {
    if (reduced()) staticFrame();
    else run();
  }

  function track(x: number, y: number) {
    const t = now();
    if (hoverCat && pointer && !drag)
      strokeTravel += Math.hypot(x - pointer[0], y - pointer[1]);
    pointer = Object.assign([x, y] as Vec, { t });
    samples.push({ x, y, t });
    while (samples.length && t - samples[0]!.t > 900) samples.shift();
    stir();
    // A deliberate drag picks it up; the wobble of a click or a pat doesn't.
    if (drag && !drag.on && Math.hypot(x - drag.x, y - drag.y) > 14) {
      drag.on = true;
      body.grab(t);
      speak('grab', t, 60, true);
      sent = null;
      whim = null;
    }
    const over = Boolean(lastSkeleton && inside(lastSkeleton, x, y, 6));
    if (over !== hoverCat) {
      hoverCat = over;
      document.body.style.cursor = over ? 'pointer' : '';
    }
    run();
  }

  function leave() {
    pointer = null;
    if (hoverCat) {
      hoverCat = false;
      document.body.style.cursor = '';
    }
  }

  /** Follow a client point, or let it go once it leaves the band. */
  function follow(clientX: number, clientY: number) {
    const [x, y] = local(clientX, clientY);
    if (drag?.on || (y >= 0 && y <= height)) track(x, y);
    else leave();
  }

  function setNav(link: HTMLAnchorElement | null, linger = NAV_LINGER) {
    if (link) {
      navTarget = link;
      navUntil = Infinity;
      interest = { kind: 'nav', el: link };
      interestUntil = Infinity;
    } else {
      navUntil = now() + linger;
      interestUntil = now() + 900;
    }
    stir();
    refresh();
  }

  /** Conjure a platform (or use the ground) for a landing at (x, y). */
  function landingAt(x: number, y: number, appearIn = 360): SurfaceId {
    const ground = surfaces.ground;
    if (y > ground.y - 70 * scale) return 'ground';
    const top = 150 * scale;
    const py = Math.max(top, y);
    const half = 66 * scale;
    const cx = Math.min(width - half - 6, Math.max(half + 6, x));
    const id = `p${++platformCount}`;
    const t = now();
    platforms.set(id, {
      x0: cx - half,
      x1: cx + half,
      y: py,
      born: t + appearIn,
      dieAt: Infinity,
    });
    // Old platforms that are already fading go; keep the scene light.
    for (const [key, p] of platforms)
      if (p.dieAt + 800 < t || platforms.size > 6) platforms.delete(key);
    surfaces[id] = platforms.get(id)!;
    body.setSurfaces(surfaces, scale);
    return id;
  }

  /** Send the cat to (x, y): walk if it's on the ground, else leap. */
  function sendTo(x: number, y: number) {
    life.hear(x < body.x ? -1 : 1, now());
    const surface = landingAt(x, y);
    sent = { surface, x, until: now() + PLATFORM_STAY };
    navTarget = null;
    whim = null;
    lastLeap = now();
    stir();
    run();
  }

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      follow(e.clientX, e.clientY);
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) leave();
  });
  const onTouch = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) follow(touch.clientX, touch.clientY);
  };
  addEventListener('touchstart', onTouch, { passive: true });
  addEventListener('touchmove', onTouch, { passive: true });
  addEventListener('touchend', () => (pointer = null), { passive: true });

  addEventListener('keydown', (e) => {
    stir();
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-6);
    // Call it like a cat: "pspsps".
    if (typed === 'pspsps') {
      typed = '';
      tiltUntil = now() + 1400;
      if (pointer) sendTo(pointer[0], surfaces.ground.y);
      run();
    }
  });
  addEventListener(
    'scroll',
    () => {
      // The band scrolls with the page, so its surfaces stay put in it.
      if (!band) {
        measure();
        body.setSurfaces(surfaces, scale);
      }
      stir();
    },
    { passive: true },
  );

  for (const link of navLinks) {
    link.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') setNav(link);
    });
    link.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && navTarget === link) setNav(null);
    });
    link.addEventListener('pointerdown', () => setNav(link));
    link.addEventListener('focus', () => setNav(link));
    link.addEventListener('blur', () => {
      if (navTarget === link) setNav(null);
    });
  }
  // Clicks and taps: grab or pet the cat, or send it to the spot.
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest('a, button')) return;
    const [x, y] = local(e.clientX, e.clientY);
    if (y < 0 || y > height) return;
    if (lastSkeleton && inside(lastSkeleton, x, y, coarse ? 14 : 4)) {
      // Pressed on the cat: a drag picks it up, a click pets it. No text
      // selection while carrying it across the page.
      e.preventDefault();
      drag = { x, y, on: false };
      if (reduced()) poke();
      return;
    }
    if (reduced()) return;
    sendTo(x, y);
  });
  const release = () => {
    if (!drag) return;
    const was = drag;
    drag = null;
    if (!was.on) {
      if (!reduced()) poke();
      return;
    }
    // Let go: a platform appears under its paws, or it lands on the ground.
    const surface = landingAt(body.x, body.y + 4, 0);
    body.drop(now(), surface);
    droppedAt = now();
    // Set down: it shakes off the indignity once it's on its feet.
    life.trigger('shake', now(), 450);
    sent = { surface, x: body.x, until: now() + PLATFORM_STAY };
    sky.dust(body.x, body.y, 8, 70);
    run();
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  // While carrying on a touch screen, the page must not scroll.
  addEventListener(
    'touchmove',
    (e) => {
      if (drag?.on) e.preventDefault();
    },
    { passive: false },
  );

  petButton?.addEventListener('click', () => poke());
  petButton?.addEventListener('focus', () => {
    petFocus = true;
    stir();
    run();
  });
  petButton?.addEventListener('blur', () => {
    petFocus = false;
    run();
  });

  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    navTarget = null;
    sent = null;
    drag = null;
    measure();
    body.setSurfaces(surfaces, scale);
    body.place('ground', width * 0.3, 'sit');
    run();
  });

  // ---------- reactions ----------

  let petAt = -Infinity;
  let purrAt = -Infinity;
  let wakeAt = -Infinity;
  let swat: { at: number; x: number; y: number; caught: boolean } | null = null;

  /** What it's saying, if anything, in a manga balloon. */
  let bubble: Bubble | null = null;
  let greeting = false;

  /** Speak, unless it spoke a moment ago (`force` interrupts). */
  function speak(saying: Saying, t: number, delay = 0, force = false) {
    if (reduced()) return;
    if (!force && bubble && t < bubble.born + bubble.life + 1800) return;
    const [hx] = headPoint();
    // Float out on the side with room, else the side it faces.
    const side: 1 | -1 =
      hx > width - 160 * scale ? -1 : hx < 160 * scale ? 1 : body.facing;
    bubble = makeBubble(saying, t + delay, side);
    run();
  }

  function say(text: string) {
    if (live) live.textContent = text;
  }

  function headPoint(): Vec {
    return lastSkeleton?.head ?? [body.x, body.y - 90 * scale];
  }

  function poke() {
    stir();
    const result = mind.poke(now());
    if (result === 'pet') {
      petAt = now();
      if (Math.random() < 0.35) speak('pet', petAt, 380);
      const [x, y] = headPoint();
      sky.ring(x, y, 0.35);
    }
    if (reduced()) staticFrame(true);
    run();
  }

  function handle(event: MindEvent, t: number) {
    const [hx, hy] = headPoint();
    switch (event) {
      case 'exchange':
        say('the cat blinks back.');
        break;
      case 'purr':
        purrAt = t;
        speak('purr', t, 200, true);
        if (body.rest === 'sit' && Math.random() < 0.6)
          life.trigger('knead', t, 1400);
        sky.ring(hx, hy, 1);
        sky.ring(hx, hy, 0.6, 520);
        sky.ring(hx, hy, 0.35, 1040);
        say('it purrs.');
        break;
      case 'sleep':
        say('the cat fell asleep.');
        break;
      case 'wake':
        wakeAt = t;
        // Surfacing: often a big yawn, sometimes a whole stretch.
        if (Math.random() < 0.7)
          life.trigger(Math.random() < 0.3 ? 'stretch' : 'yawn', t, 900);
        break;
      case 'swipe': {
        if (!pointer || !lastSkeleton || drag || body.mode === 'held') break;
        const [sx, sy] = lastSkeleton.shoulder;
        const reach = 95 * scale;
        if (Math.hypot(pointer[0] - sx, pointer[1] - sy) < reach) {
          swat = { at: t, x: pointer[0], y: pointer[1], caught: false };
        }
        break;
      }
    }
  }

  // ---------- the loop ----------

  const face: Face = restingFace({ open: 0, pupil: 0.35 });
  /** Eased parts of the face; the life layer's quick motions add on top. */
  let roll = 0;
  let blush = 0;
  let happy = 0;
  let ears: [number, number] = [0, 0];
  let swivel: [number, number] = [0, 0];
  let expr: Expression | null = null;
  let hoverSince = 0;
  /** Eased 0..1 lean into a hovering hand, and which side the hand is on. */
  let leaning = 0;
  let leanSide: 1 | -1 = 1;
  /** Where the body was last frame: its velocity swings the tail. */
  let lastBody: Vec | null = null;
  let breath = 0;
  let lastDim = '';
  let lastDust = 0;
  let lastZee = 0;
  let zee = 0;
  let frame = 0;
  let last = 0;
  let lastDraw = 0;
  let dim = 0;
  const born = now();
  catCanvas.style.transition = reduced() ? 'none' : 'opacity 520ms ease-out';
  catCanvas.style.opacity = '1';

  function run() {
    if (!frame && !document.hidden && onScreen && !reduced()) {
      last = now();
      frame = requestAnimationFrame(tick);
    }
  }

  /** Something to do of its own accord. Weighted, so never quite the same. */
  function nextWhim(t: number): NonNullable<typeof whim> {
    const r = Math.random();
    const ground = surfaces.ground;
    const span = ground.x1 - ground.x0;
    const near = (d: number) =>
      Math.min(ground.x1 - 40, Math.max(ground.x0 + 40, body.x + d));
    if (r < 0.4)
      return {
        rest: 'sit',
        surface: 'ground',
        x: ground.x0 + span * (0.08 + Math.random() * 0.84),
        until: t + 4000 + Math.random() * 4000,
      };
    if (r < 0.62)
      return {
        rest: 'sit',
        surface: body.bound,
        x: body.x,
        until: t + 2500 + Math.random() * 3500,
      };
    if (r < 0.74)
      return {
        rest: 'stand',
        surface: body.bound,
        x: body.x,
        until: t + 2500 + Math.random() * 2000,
      };
    if (r < 0.86)
      return {
        rest: 'loaf',
        surface: body.bound,
        x: near(0),
        until: t + 5000 + Math.random() * 4000,
      };
    // Now and then: up onto the name for a look round.
    return {
      rest: 'sit',
      surface: 'perch',
      x: home,
      until: t + 6000 + Math.random() * 5000,
    };
  }

  function chooseGoal(t: number, out: MindOutput): { goal: Goal; rest?: Rest } {
    const sleepy: Rest | undefined =
      out.phase === 'asleep'
        ? 'sleep'
        : out.phase === 'drowsy'
          ? 'loaf'
          : undefined;
    const here = { surface: body.bound, x: body.x };
    // Being petted or stroked, it stays for it rather than wandering off.
    if ((hoverCat || t - strokeAt < 2500) && body.mode === 'rest') {
      if (whim) whim.until = Math.max(whim.until, t + 2000);
      if (sent) sent.until = Math.max(sent.until, t + 2000);
    }
    // The opening: curled up, then it sits up.
    if (t - born < 1000) return { goal: { ...here, rest: 'loaf' } };
    if (navTarget && t > navUntil) navTarget = null;
    const centre = width / 2;

    // Under the page you are pointing at, looking up at it.
    if (navTarget) {
      const x = navAt.get(navTarget)?.[0] ?? centre;
      whim = null;
      return {
        goal: {
          surface: 'ground',
          x,
          rest: 'sit',
          hurry: true,
          float: true,
          face: x < centre - 4 ? 1 : x > centre + 4 ? -1 : undefined,
        },
      };
    }
    if (sent) {
      // Up on a platform with nothing going on: after a while, float down.
      if (t > sent.until && out.phase === 'awake') sent = null;
      else
        return {
          goal: {
            surface: sent.surface,
            x: sent.x,
            rest: 'sit',
            hurry: true,
            float: true,
          },
          rest: sleepy,
        };
    }
    if (sleepy) return { goal: { ...here, rest: 'sit' }, rest: sleepy };
    if (!whim || t > whim.until) whim = nextWhim(t);
    if (
      whim.surface !== 'ground' &&
      whim.surface !== 'perch' &&
      !surfaces[whim.surface]
    )
      whim.surface = 'ground';
    return {
      goal: {
        surface: whim.surface,
        x: whim.x,
        rest: whim.rest,
        float: whim.surface !== body.surface,
      },
    };
  }

  function lookTarget(t: number, sk: Skeleton | null): Vec | null {
    if (interest && t > interestUntil) interest = null;
    if (interest) return navAt.get(interest.el) ?? null;
    // A moving pointer wins; a resting one is watched until something
    // else catches its eye.
    if (pointer && (t - pointer.t < 1500 || hoverCat))
      return [pointer[0], pointer[1]];
    if (sk && expr?.glance)
      return [sk.head[0] + expr.glance[0], sk.head[1] + expr.glance[1]];
    if (pointer && t - pointer.t < 6000) return [pointer[0], pointer[1]];
    if (sk && body.mode === 'walk')
      return [sk.head[0] + body.facing * 300, sk.head[1] + 40];
    return null;
  }

  function tick(t: number) {
    frame = 0;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const quietFor = t - lastInput;
    // Back-and-forth over the cat is stroking it, which is not a hunt.
    const stroking = hoverCat && Boolean(pointer && t - pointer.t < 300);
    strokeTravel *= Math.exp(-dt * 1.5);
    if (stroking && strokeTravel > 140 * scale && t - strokeAt > 650) {
      strokeAt = t;
      strokeTravel = 0;
      mind.stroke(t);
      if (!strokePurred) {
        strokePurred = true;
        speak('purr', t, 250, true);
      }
    }
    if (t - strokeAt > 6000) strokePurred = false;
    const dart = hoverCat || drag ? 0 : dartScore(samples, t);
    const out = mind.tick({
      now: t,
      quietFor,
      dart,
      interested: Boolean(interest) || Boolean(navTarget),
      engaged: engaged || t - born > 6000,
    });
    for (const event of out.events) handle(event, t);

    // Shaking the cursor: it winds up and leaps at it, anywhere.
    if (
      pointer &&
      !drag?.on &&
      !hoverCat &&
      out.phase === 'awake' &&
      out.hunting > 0.7 &&
      t - lastLeap > LEAP_COOLDOWN &&
      !body.airborne &&
      t - born > 1000
    ) {
      const recent = samples.filter((p) => t - p.t < 320);
      const cx = recent.reduce((a, p) => a + p.x, 0) / (recent.length || 1);
      const cy = recent.reduce((a, p) => a + p.y, 0) / (recent.length || 1);
      sendTo(cx, cy + 34 * scale);
    }

    if (drag?.on && pointer) body.holdAt(pointer[0], pointer[1], dt);
    const chosen = chooseGoal(t, out);
    const { goal } = chosen;
    const rest = chosen.rest ?? expr?.rest;
    const resting = body.mode === 'rest' || body.mode === 'walk';
    const wasFloat = body.leap?.float;
    for (const event of body.step(
      dt,
      t,
      goal,
      drag?.on ? 0 : out.hunting,
      resting ? rest : undefined,
    )) {
      if (event === 'landed') {
        const dropped = droppedAt > 0;
        droppedAt = 0;
        sky.dust(body.x, body.y, wasFloat ? 8 : 4, wasFloat ? 70 : 40);
        // Landed by the cursor it was after: a swat, and maybe a catch —
        // never at the hand that just set it down.
        if (
          !dropped &&
          pointer &&
          Math.hypot(pointer[0] - body.x, pointer[1] - body.y) < 140 * scale
        )
          swat = { at: t, x: pointer[0], y: pointer[1], caught: false };
      }
      if (
        event === 'pounced' &&
        pointer &&
        Math.abs(pointer[0] - body.x) < 40 * scale
      )
        sky.sparkle(pointer[0], pointer[1]);
    }
    if (body.mode === 'air' && body.leap?.float && t - lastDust > 70) {
      lastDust = t;
      sky.dust(body.x, body.y - 30 * scale, 1, 18);
    }
    // Platforms it has left dissolve into dust.
    for (const [id, p] of platforms) {
      const used =
        body.surface === id || body.bound === id || sent?.surface === id;
      if (!used && p.dieAt === Infinity) {
        p.dieAt = t;
        for (let i = 0; i < 4; i++)
          sky.dust(p.x0 + ((p.x1 - p.x0) * (i + 0.5)) / 4, p.y, 2, 25);
      }
      if (p.dieAt + 800 < t) {
        platforms.delete(id);
        delete surfaces[id];
      }
    }
    // Asleep: z, z, Z, drifting up from its head.
    if (out.phase === 'asleep' && t - lastZee > 1150) {
      lastZee = t;
      const [glyph, size] = ZEES[zee++ % ZEES.length]!;
      const [hx0, hy0] = headPoint();
      sky.zee(
        hx0 + body.facing * 16 * scale,
        hy0 - 24 * scale,
        size * scale,
        glyph,
      );
    }

    // ---- life: habits, ears, tail ----
    if (hoverCat) hoverSince ||= t;
    else hoverSince = 0;
    const attentive =
      Boolean(interest) ||
      Boolean(navTarget) ||
      Boolean(drag) ||
      hoverCat ||
      out.offering ||
      Boolean(
        pointer &&
        t - pointer.t < 1500 &&
        lastSkeleton &&
        Math.hypot(
          pointer[0] - lastSkeleton.head[0],
          pointer[1] - lastSkeleton.head[1],
        ) <
          260 * scale,
      );
    const pose = body.pose;
    // Leaps, landings and a swinging carry all reach the tail; a jump in
    // position (a relayout) does not.
    let vx = 0;
    let vy = 0;
    if (lastBody && dt > 0) {
      vx = (body.x - lastBody[0]) / dt;
      vy = (body.y - lastBody[1]) / dt;
      if (Math.hypot(vx, vy) > 3000 * scale) vx = vy = 0;
    }
    lastBody = [body.x, body.y];
    expr = life.tick({
      now: t,
      dt,
      mode: body.mode,
      rest: body.rest,
      phase: out.phase,
      hunting: out.hunting,
      purring: out.purring,
      attentive,
      head: pose.head,
      front: pose.front,
      tailAngle: pose.tailAngle,
      tailCurl: pose.tailCurl,
      vx,
      vy,
      scale,
      facing: body.facing,
    });
    if (expr.blink) mind.blink(t);
    // A sound the face makes gets its balloon.
    switch (expr.started) {
      case 'meow':
        speak(greeting ? 'hello' : 'meow', t, 120, true);
        greeting = false;
        break;
      case 'sneeze':
        speak('sneeze', t, 690, true);
        break;
      case 'yawn':
        if (Math.random() < 0.55) speak('yawn', t, 520);
        break;
    }
    if (bubble && !bubbleAlive(bubble, t)) bubble = null;

    // ---- face ----
    const target = lookTarget(t, lastSkeleton);
    const [hx, hy] = headPoint();
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    let yawTo = 0;
    let gazeTo: Vec = [0, 0];
    let pupilTo = 0.32;
    let earsTo: [number, number] = [0, 0];
    if (target) {
      const dx = target[0] - hx;
      const dy = target[1] - hy;
      yawTo = clamp(dx / 320, -1, 1) * 0.85;
      gazeTo = gazeOffset(dx, dy, 2.3, 1.5, 180);
      const d = Math.hypot(dx, dy);
      if (interest?.kind === 'nav') {
        pupilTo = 0.72;
        const ear = nearerEar(target[0], hx);
        earsTo = ear < 0 ? [0.7, 0.25] : [0.25, 0.7];
      }
      // A pointer right in its face is bright: the pupils go to slits.
      if (d < 70 * scale && interest === null) pupilTo = 0.04;
    }
    // On the move it looks where it's going: the head turns three-quarter.
    if (body.mode === 'walk' || body.mode === 'air' || body.mode === 'windup')
      yawTo = body.facing * 0.8;
    // Carried: eyes wide, ears back, a little indignant.
    if (body.mode === 'held') {
      pupilTo = 0.9;
      earsTo = [-0.45, -0.45];
    }
    if (out.hunting > 0) {
      pupilTo = Math.max(pupilTo, 0.6 + out.hunting * 0.4);
      earsTo = [0.85, 0.85];
    }
    if (body.mode === 'air' || body.mode === 'windup') earsTo = [0.6, 0.6];
    const pet = bump(t - petAt, 1300);
    if (pet > 0) earsTo = [-0.35 * pet, -0.35 * pet];
    if (out.purring) earsTo = [earsTo[0] - 0.15, earsTo[1] - 0.15];
    // Waking: one ear flicks.
    const flick = bump(t - wakeAt, 240);
    earsTo[0] -= flick * 0.9;
    if (out.phase === 'asleep') earsTo = [-0.2, -0.2];
    let swivelTo: [number, number] = [0, 0];
    let rollTo = t < tiltUntil ? 0.22 : out.phase === 'asleep' ? 0.1 : 0;
    let leanTo = 0;
    // Hovered over: it leans into the hand it expects, eyes going soft. The
    // lean eases in and out — a press, or the pointer slipping off the
    // edge, must not snap the head — and the side is read from where the
    // head rests, not where it leans, with a dead zone so it can't flip-flop.
    const wantLean =
      hoverSince && !drag && out.phase === 'awake' && body.mode === 'rest'
        ? clamp((t - hoverSince - 250) / 600)
        : 0;
    leaning += (wantLean - leaning) * ease(wantLean > leaning ? 5 : 7);
    const lean = leaning < 0.002 ? 0 : leaning;
    if (pointer) {
      const rest = body.x + body.facing * body.pose.head[0] * scale;
      if (pointer[0] > rest + 10 * scale) leanSide = 1;
      else if (pointer[0] < rest - 10 * scale) leanSide = -1;
    }
    if (lean > 0) {
      rollTo += leanSide * 0.12 * lean;
      leanTo = leanSide * body.facing * 2.2 * lean;
      earsTo = [earsTo[0] - 0.2 * lean, earsTo[1] - 0.2 * lean];
      swivelTo = [0.25 * lean, 0.25 * lean];
    }
    const purring = t - purrAt < 3600 || out.purring;
    yawTo = clamp(yawTo + expr.yaw, -1, 1);
    gazeTo = [gazeTo[0] + expr.saccade[0], gazeTo[1] + expr.saccade[1]];
    pupilTo = clamp(pupilTo + expr.pupil);

    face.yaw += (yawTo - face.yaw) * ease(7);
    face.gaze = [
      face.gaze[0] + (gazeTo[0] - face.gaze[0]) * ease(16),
      face.gaze[1] + (gazeTo[1] - face.gaze[1]) * ease(16),
    ];
    face.pupil += (pupilTo - face.pupil) * ease(6);
    ears = [
      ears[0] + (earsTo[0] - ears[0]) * ease(16),
      ears[1] + (earsTo[1] - ears[1]) * ease(16),
    ];
    swivel = [
      swivel[0] + (swivelTo[0] - swivel[0]) * ease(9),
      swivel[1] + (swivelTo[1] - swivel[1]) * ease(9),
    ];
    roll += (rollTo - roll) * ease(6);
    const stroked = t - strokeAt < 1100;
    const glad = pet > 0.05 || stroked;
    happy += ((glad ? 1 : 0) - happy) * ease(glad ? 14 : 6);
    blush += ((pet > 0 || purring ? 1 : lean * 0.5) - blush) * ease(3);
    face.shiver += ((purring ? 1 : 0) - face.shiver) * ease(5);

    // The life layer's quick motions ride on top, unsmoothed.
    face.roll = roll + expr.roll;
    face.pitch = expr.pitch + (out.phase === 'asleep' ? 0.15 : 0);
    face.ears = [ears[0] + expr.ears[0], ears[1] + expr.ears[1]];
    face.swivel = [swivel[0] + expr.swivel[0], swivel[1] + expr.swivel[1]];
    face.open = clamp(
      out.lid * (1 - out.closure) * expr.open * (1 - 0.35 * lean),
    );
    face.happy = clamp(Math.max(happy, expr.happy));
    face.smile = clamp(out.smile + expr.smile + lean * 0.4);
    face.squint = clamp(expr.squint + out.hunting * 0.3);
    face.wide = clamp(expr.wide + (body.mode === 'held' ? 0.5 : 0));
    face.mouth = clamp(expr.mouth);
    face.tongue = clamp(expr.tongue);
    face.blush = clamp(blush * 0.85 + expr.blush);
    face.shiver = Math.max(face.shiver, clamp(expr.shiver));
    face.glow = out.offering
      ? 0.5 + 0.5 * Math.sin((t - mind.offerAt) / 520)
      : 0;
    face.time = t / 1000;

    // Breathing drifts in tempo; asleep it slows and deepens.
    breath +=
      dt *
      (out.phase === 'asleep' ? 1.5 : 2.4) *
      (1 + 0.15 * Math.sin(t / 4100) * Math.sin(t / 2300));
    let swatWeight = 0;
    if (swat) {
      const age = t - swat.at;
      swatWeight = bump(age, 420);
      if (
        !swat.caught &&
        age > 180 &&
        pointer &&
        Math.hypot(pointer[0] - swat.x, pointer[1] - swat.y) < 30
      ) {
        swat.caught = true;
        sky.sparkle(swat.x, swat.y);
      }
      if (age > 420) swat = null;
    }

    const drawn = body.drawPose();
    drawn.head = [
      drawn.head[0] + expr.head[0] + leanTo,
      drawn.head[1] + expr.head[1],
    ];
    const state: BodyState = {
      x: body.x,
      y: body.y,
      scale,
      face: body.face,
      tilt: body.tilt,
      pose: drawn,
      walk: body.walk,
      gait: body.gait,
      phase: body.phase,
      time: t / 1000,
      breath,
      tail: {
        wave:
          out.phase === 'asleep'
            ? 0.03
            : body.mode === 'held'
              ? 0.3
              : body.mode === 'walk'
                ? 0.14
                : 0.09,
        lash: out.hunting * 0.35 + (body.wiggle > 0 ? 0.25 : 0),
      },
      tailAngles: life.tail.angles,
      paws: expr.paws,
      swat: swat ? { at: [swat.x, swat.y], weight: swatWeight } : undefined,
    };
    const sk = skeleton(state);
    lastSkeleton = sk;
    // The cat moves under a still pointer too: keep the hover (and the hand
    // cursor) true to where it is now.
    if (pointer && !coarse) {
      const over = inside(sk, pointer[0], pointer[1], 6);
      if (over !== hoverCat) {
        hoverCat = over;
        root.style.cursor = over ? 'pointer' : '';
      }
    }
    // Carried, it comes in front of the words; back behind once it's down.
    const raise =
      body.mode === 'held' ||
      (lifted && body.mode !== 'rest' && body.mode !== 'walk');
    if (raise !== lifted) {
      lifted = raise;
      catCanvas!.classList.toggle('is-lifted', raise);
    }

    // Idle frames can run at half rate; motion runs every frame.
    // Platforms only need full rate while growing in or dissolving.
    let settling = false;
    for (const pl of platforms.values())
      if (t - pl.born < 400 || pl.dieAt !== Infinity) settling = true;
    const moving =
      settling ||
      body.mode !== 'rest' ||
      t - lastInput < 1500 ||
      swat ||
      purring ||
      out.offering ||
      life.lively ||
      bubble;
    if (moving || t - lastDraw > 48) {
      paint(sk);
      lastDraw = t;
    }

    // DOM writes only when the value changes: each one costs a style pass.
    dim += ((out.dim ? 0.1 : 0) - dim) * ease(out.dim ? 0.6 : 5);
    const dimText = dim < 0.002 ? '0' : dim.toFixed(2);
    if (dimEl && dimText !== lastDim) dimEl.style.opacity = lastDim = dimText;
    sky.frame(t, dt, false);
    if (!document.hidden && onScreen) frame = requestAnimationFrame(tick);
  }

  let dirty: Skeleton['box'][] = [];

  function paint(sk: Skeleton) {
    for (const b of dirty)
      ctx.clearRect(b.x0 - 8, b.y0 - 8, b.x1 - b.x0 + 16, b.y1 - b.y0 + 16);
    dirty = [{ ...sk.box }];
    const t = now();
    for (const p of platforms.values()) {
      drawPlatform(ctx, p, t);
      const half = (p.x1 - p.x0) / 2;
      dirty.push({
        x0: p.x0 - half * 0.3,
        y0: p.y - 14,
        x1: p.x1 + half * 0.3,
        y1: p.y + 18,
      });
    }
    drawCat(ctx, sk, face, { focus: petFocus });
    if (bubble) {
      // The balloon's tail finds the mouth, wherever the head has turned.
      const k = sk.scale;
      const mouth: Vec = [
        sk.head[0] + (face.yaw * 10.5 + Math.sin(face.roll) * -12) * k,
        sk.head[1] + 12 * k,
      ];
      const area = drawBubble(ctx, bubble, t, mouth, scale, { width, height });
      if (area) dirty.push(area);
    }
  }

  // ---------- reduced motion: a still portrait ----------

  function staticFrame(petted = false) {
    measure();
    body.setSurfaces(surfaces, scale);
    body.place('ground', width * 0.3, 'sit');
    const target = lookTarget(now(), lastSkeleton);
    const sk0 = skeleton({
      x: body.x,
      y: body.y,
      scale,
      face: body.face,
      tilt: 0,
      pose: body.pose,
      walk: 0,
      gait: 0,
      phase: 0,
      time: 0,
      breath: 0,
      tail: { wave: 0, lash: 0 },
    });
    const [hx, hy] = sk0.head;
    face.yaw = target ? clamp((target[0] - hx) / 320, -1, 1) * 0.85 : 0;
    face.gaze = target
      ? gazeOffset(target[0] - hx, target[1] - hy, 2.3, 1.5, 180)
      : [0, 0.6];
    Object.assign(
      face,
      restingFace({
        yaw: face.yaw,
        gaze: face.gaze,
        open: petted ? 0 : 0.74,
        happy: petted ? 1 : 0,
        blush: petted ? 0.8 : 0,
        smile: 0.3,
      }),
    );
    lastSkeleton = sk0;
    ctx.clearRect(0, 0, width, height);
    drawCat(ctx, sk0, face, { focus: petFocus });
    dirty = [{ ...sk0.box }];
    sky.frame(now(), 0, true);
    if (petted) setTimeout(() => staticFrame(false), 1400);
  }

  // ---------- lifecycle ----------

  function relayout() {
    fitBand();
    ({ width, height } = frameBox());
    ctx = fit(catCanvas!, width, height);
    dirty = [];
    sky.resize(width, height);
    measure();
    body.setSurfaces(surfaces, scale);
    if (reduced()) staticFrame();
    else run();
  }

  // Entrance animations shift boxes while they run; measure again after.
  root.addEventListener('animationend', () => {
    measure();
    body.setSurfaces(surfaces, scale);
  });

  let resizeFrame = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(relayout);
  });
  document.fonts?.ready.then(relayout);
  reducedQuery.addEventListener('change', () => {
    cancelAnimationFrame(frame);
    frame = 0;
    relayout();
  });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = now();
      cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    // Back after a while: it had dozed off, and wakes to see you.
    if (now() - hiddenAt > 20000) stir();
    if (reduced()) staticFrame();
    else run();
  });

  // Scrolled past, the band rests like a hidden tab: no frames drawn.
  if (band)
    new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      if (onScreen) refresh();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }).observe(band);

  sky.resize(width, height);
  if (reduced()) staticFrame();
  else run();
}
