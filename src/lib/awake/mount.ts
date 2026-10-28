import {
  CatBody,
  type Goal,
  type Rest,
  type Surface,
  type SurfaceId,
} from './body';
import { drawCat, type Face } from './draw';
import { dartScore, gazeOffset, nearerEar, type Sample } from './gaze';
import { CatMind, type MindEvent, type MindOutput } from './mind';
import { skeleton, type BodyState, type Skeleton, type Vec } from './rig';
import { createSky } from './sky';
import { bump, clamp } from './spring';

/**
 * Wires the cat to the page. The cat lives on a canvas behind the type and
 * moves between two measured surfaces — the top of the name and the floor
 * line over the nav. Each frame it picks one goal, in priority order: a page
 * it was asked about (hover, focus, touch), a spot it was called to, a cursor
 * worth hunting, or home on the name. The mind (moods, blinks, the slow-blink
 * exchange) and the body (walking, jumping) are pure; this file is the glue.
 */

type Interest =
  | { kind: 'nav'; el: HTMLAnchorElement }
  | { kind: 'moon' | 'contact' | 'point'; x: number; y: number };

const HOME_DELAY = 3200;
const NAV_LINGER = 2600;
const CALL_LINGER = 6500;
const NAV_DELAY = 320;

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
  const floorEl = $<HTMLElement>('[data-awake-floor]');
  const petButton = $<HTMLButtonElement>('[data-awake-pet]');
  if (!catCanvas || !skyCanvas || !fxCanvas || !perchEl || !floorEl) return;
  const navLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>('[data-home-nav]'),
  ];
  const contactLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>('.awake-contact a'),
  ];
  const moon = $<HTMLElement>('[data-awake-moon]');
  const dimEl = $<HTMLElement>('[data-awake-dim]');
  const live = $<HTMLElement>('[data-awake-live]');
  const friendEyes = [
    ...document.querySelectorAll<SVGGElement>('[data-awake-friend-eye]'),
  ].map((el) => ({ el, base: el.getAttribute('transform') ?? '' }));
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const now = () => performance.now();

  const sky = createSky(skyCanvas, fxCanvas);
  let ctx = fit(catCanvas, innerWidth, innerHeight);
  let width = innerWidth;
  let height = innerHeight;

  // ---------- measuring the page ----------

  let scale = 1;
  let home = 0;
  let navAt = new Map<HTMLAnchorElement, Vec>();
  let floorBand: [number, number] = [0, 0];
  let surfaces: Record<SurfaceId, Surface> = {
    perch: { x0: 0, x1: 0, y: 0 },
    floor: { x0: 0, x1: 0, y: 0 },
  };
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
    let wordBox = perchEl!.getBoundingClientRect();
    let restX = wordBox.left + wordBox.width / 2;
    let inkTop = wordBox.top + wordBox.height * 0.2;
    if (text) {
      const start = text.data.search(/\S/);
      const word = text.data.trim();
      range.setStart(text, start);
      range.setEnd(text, start + word.length);
      wordBox = range.getBoundingClientRect();
      // Sit on the tall letters ("dd"), where the ascenders give a ledge.
      const tall = word.indexOf('dd');
      if (tall >= 0) {
        range.setStart(text, start + tall);
        range.setEnd(text, start + tall + 2);
        const box = range.getBoundingClientRect();
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
    // The line draws in with a scaleX transform; its box is the ground's.
    const floor = (floorEl!.parentElement ?? floorEl!).getBoundingClientRect();
    surfaces = {
      perch: { x0: wordBox.left - 6, x1: wordBox.right + 6, y: inkTop + 1.5 },
      floor: {
        x0: floor.left + floor.width * 0.08,
        x1: floor.right - floor.width * 0.08,
        y: floorEl!.getBoundingClientRect().top + 0.5,
      },
    };
    floorBand = [surfaces.floor.y - 150 * scale, surfaces.floor.y + 70];
    navAt = new Map(
      navLinks.map((link) => {
        const r = link.getBoundingClientRect();
        return [link, [r.left + r.width / 2, r.top + r.height / 2]];
      }),
    );
  }

  measure();
  const reduced = () => reducedQuery.matches;
  const mind = new CatMind(now());
  const body = new CatBody(
    surfaces,
    { surface: 'perch', x: home, pose: reduced() ? 'sit' : 'loaf' },
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
  let call: { x: number; until: number } | null = null;
  let awayUntil = 0;
  let pounceNav: HTMLAnchorElement | null = null;
  let tiltUntil = 0;
  let typed = '';
  let friendUntil = -Infinity;
  let petFocus = false;
  let lastSkeleton: Skeleton | null = null;
  let hoverCat = false;

  function stir() {
    lastInput = now();
    engaged = true;
    if (mind.stir(now())) run();
  }

  /** Redraw after an input: the loop when moving, one still frame if not. */
  function refresh() {
    if (reduced()) staticFrame();
    else run();
  }

  function track(x: number, y: number) {
    const t = now();
    pointer = Object.assign([x, y] as Vec, { t });
    samples.push({ x, y, t });
    while (samples.length && t - samples[0]!.t > 900) samples.shift();
    stir();
    const over = Boolean(lastSkeleton && inside(lastSkeleton, x, y, 6));
    if (over !== hoverCat) {
      hoverCat = over;
      root.style.cursor = over ? 'pointer' : '';
    }
    run();
  }

  function setNav(link: HTMLAnchorElement | null, linger = NAV_LINGER) {
    if (link) {
      navTarget = link;
      navUntil = Infinity;
      interest = { kind: 'nav', el: link };
      interestUntil = Infinity;
      call = null;
    } else {
      navUntil = now() + linger;
      interestUntil = now() + 900;
    }
    stir();
    refresh();
  }

  function look(
    kind: 'moon' | 'contact' | 'point',
    x: number,
    y: number,
    ms: number,
  ) {
    interest = { kind, x, y };
    interestUntil = ms === Infinity ? Infinity : now() + ms;
    stir();
    refresh();
  }

  function callTo(x: number) {
    call = { x, until: now() + CALL_LINGER };
    navTarget = null;
    awayUntil = now() + CALL_LINGER + HOME_DELAY;
    stir();
    run();
  }

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      track(e.clientX, e.clientY);
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) {
      pointer = null;
      if (hoverCat) {
        hoverCat = false;
        root.style.cursor = '';
      }
    }
  });
  const onTouch = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) track(touch.clientX, touch.clientY);
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
      if (pointer && pointer[1] > floorBand[0]) callTo(pointer[0]);
      else {
        call = null;
        navTarget = null;
        awayUntil = 0;
      }
      run();
    }
  });
  addEventListener(
    'scroll',
    () => {
      measure();
      body.setSurfaces(surfaces, scale);
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
    link.addEventListener('click', (e) => {
      if (
        reduced() ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      e.preventDefault();
      pounceNav = link;
      setNav(link);
      run();
      const href = link.href;
      setTimeout(() => location.assign(href), NAV_DELAY);
    });
  }
  for (const link of contactLinks) {
    const at = () => {
      const r = link.getBoundingClientRect();
      look('contact', r.left + r.width / 2, r.top + r.height / 2, Infinity);
    };
    link.addEventListener('pointerenter', at);
    link.addEventListener('focus', at);
    const off = () => {
      if (interest?.kind === 'contact') interestUntil = now() + 500;
    };
    link.addEventListener('pointerleave', off);
    link.addEventListener('blur', off);
  }
  if (moon) {
    const at = () => {
      const r = moon.getBoundingClientRect();
      look('moon', r.left + r.width / 2, r.top + r.height / 2, Infinity);
      friendUntil = Infinity;
    };
    moon.addEventListener('pointerenter', at);
    moon.addEventListener('pointerleave', () => {
      if (interest?.kind === 'moon') interestUntil = now() + 600;
      friendUntil = now() + 2400;
    });
    moon.addEventListener('pointerdown', () => {
      at();
      interestUntil = now() + 2600;
      friendUntil = now() + 3400;
    });
  }

  // Clicks and taps on the page: pet the cat, call it, or point at the sky.
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest('a, button')) return;
    const x = e.clientX;
    const y = e.clientY;
    if (lastSkeleton && inside(lastSkeleton, x, y, coarse ? 14 : 4)) {
      poke();
      return;
    }
    if (reduced()) return;
    const floor = surfaces.floor;
    if (
      y >= floorBand[0] &&
      y <= floorBand[1] &&
      x >= floor.x0 - 30 &&
      x <= floor.x1 + 30
    ) {
      callTo(x);
      return;
    }
    const perch = perchEl!.getBoundingClientRect();
    if (
      y >= perch.top - 140 * scale &&
      y <= perch.bottom &&
      x >= perch.left - 40 &&
      x <= perch.right + 40
    ) {
      call = null;
      navTarget = null;
      awayUntil = 0;
      stir();
      run();
      return;
    }
    look('point', x, y, 1300);
  });

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
    pounceNav = null;
    navTarget = null;
    call = null;
    measure();
    body.setSurfaces(surfaces, scale);
    body.place('perch', home, 'sit');
    run();
  });

  // ---------- reactions ----------

  let petAt = -Infinity;
  let purrAt = -Infinity;
  let wakeAt = -Infinity;
  let swat: { at: number; x: number; y: number; caught: boolean } | null = null;

  function say(text: string) {
    if (live) live.textContent = text;
  }

  function headPoint(): Vec {
    return lastSkeleton?.head ?? [home, surfaces.perch.y - 90 * scale];
  }

  function poke() {
    stir();
    const result = mind.poke(now());
    if (result === 'pet') {
      petAt = now();
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
        break;
      case 'swipe': {
        if (!pointer || !lastSkeleton) break;
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

  const face: Face = {
    yaw: 0,
    roll: 0,
    gaze: [0, 0],
    open: 0,
    pupil: 0.35,
    ears: [0, 0],
    shiver: 0,
    glow: 0,
    time: 0,
  };
  let breath = 0;
  let frame = 0;
  let last = 0;
  let lastDraw = 0;
  let dim = 0;
  let lastBox: Skeleton['box'] | null = null;
  const born = now();
  catCanvas.style.transition = reduced() ? 'none' : 'opacity 520ms ease-out';
  catCanvas.style.opacity = '1';

  function run() {
    if (!frame && !document.hidden && !reduced()) {
      last = now();
      frame = requestAnimationFrame(tick);
    }
  }

  function chooseGoal(t: number, out: MindOutput): { goal: Goal; rest?: Rest } {
    const sleepy: Rest | undefined =
      out.phase === 'asleep'
        ? 'sleep'
        : out.phase === 'drowsy'
          ? 'loaf'
          : undefined;
    // The opening: curled up on the name, then it sits up.
    if (t - born < 1000)
      return { goal: { surface: 'perch', x: home, rest: 'loaf' } };
    if (navTarget && t > navUntil) navTarget = null;
    if (call && t > call.until) call = null;
    const centre = width / 2;

    if (pounceNav) {
      const x = navAt.get(pounceNav)?.[0] ?? centre;
      return {
        goal: {
          surface: 'floor',
          x,
          rest: 'crouch',
          hurry: true,
          pounce: body.surface === 'floor',
        },
      };
    }
    if (navTarget) {
      const x = navAt.get(navTarget)?.[0] ?? centre;
      awayUntil = t + HOME_DELAY;
      return {
        goal: {
          surface: 'floor',
          x,
          rest: 'sit',
          hurry: true,
          face: x < centre - 4 ? 1 : x > centre + 4 ? -1 : undefined,
        },
      };
    }
    if (call) {
      return {
        goal: { surface: 'floor', x: call.x, rest: 'sit', hurry: false },
        rest: sleepy,
      };
    }
    // A cursor near the floor, moving like prey, is worth hunting.
    if (
      pointer &&
      out.phase === 'awake' &&
      pointer[1] >= floorBand[0] &&
      pointer[1] <= floorBand[1] &&
      t - pointer.t < 1800 &&
      out.hunting > 0.15
    ) {
      awayUntil = t + HOME_DELAY;
      const still = t - pointer.t > 320;
      const close = Math.abs(pointer[0] - body.x) < 150 * scale;
      return {
        goal: {
          surface: 'floor',
          x: pointer[0],
          rest: 'crouch',
          hurry: true,
          pounce: still && close && body.surface === 'floor',
        },
      };
    }
    if (body.surface !== 'perch' && t < awayUntil) {
      return {
        goal: { surface: body.surface, x: body.x, rest: 'sit' },
        rest: sleepy,
      };
    }
    return { goal: { surface: 'perch', x: home, rest: 'sit' }, rest: sleepy };
  }

  function lookTarget(t: number, sk: Skeleton | null): Vec | null {
    if (interest && t > interestUntil) interest = null;
    if (interest) {
      if (interest.kind === 'nav') return navAt.get(interest.el) ?? null;
      return [interest.x, interest.y];
    }
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
    const dart = dartScore(samples, t);
    const out = mind.tick({
      now: t,
      quietFor,
      dart,
      interested: Boolean(interest) || Boolean(navTarget),
      engaged: engaged || t - born > 6000,
    });
    for (const event of out.events) handle(event, t);

    const { goal, rest } = chooseGoal(t, out);
    const resting = body.mode === 'rest' || body.mode === 'walk';
    for (const event of body.step(
      dt,
      t,
      goal,
      out.hunting,
      resting ? rest : undefined,
    )) {
      if (
        event === 'pounced' &&
        pointer &&
        Math.abs(pointer[0] - body.x) < 40 * scale
      ) {
        sky.sparkle(pointer[0], pointer[1]);
      }
    }
    if (pounceNav && body.mode === 'rest') pounceNav = null;

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
      if (interest?.kind === 'nav' || interest?.kind === 'moon') {
        pupilTo = 0.72;
        const ear = nearerEar(target[0], hx);
        earsTo = ear < 0 ? [0.7, 0.25] : [0.25, 0.7];
        if (interest.kind === 'moon') earsTo = [0.9, 0.9];
      }
      // A pointer right in its face is bright: the pupils go to slits.
      if (d < 70 * scale && interest === null) pupilTo = 0.04;
    } else if (body.mode === 'walk') {
      yawTo = body.facing * 0.45;
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

    face.yaw += (yawTo - face.yaw) * ease(7);
    face.gaze = [
      face.gaze[0] + (gazeTo[0] - face.gaze[0]) * ease(14),
      face.gaze[1] + (gazeTo[1] - face.gaze[1]) * ease(14),
    ];
    face.pupil += (pupilTo - face.pupil) * ease(6);
    face.ears = [
      face.ears[0] + (earsTo[0] - face.ears[0]) * ease(16),
      face.ears[1] + (earsTo[1] - face.ears[1]) * ease(16),
    ];
    const rollTo = t < tiltUntil ? 0.22 : out.phase === 'asleep' ? 0.1 : 0;
    face.roll += (rollTo - face.roll) * ease(6);
    face.open = clamp(out.lid * (1 - out.closure));
    const purring = t - purrAt < 3600 || out.purring;
    face.shiver += ((purring ? 1 : 0) - face.shiver) * ease(5);
    face.glow = out.offering
      ? 0.5 + 0.5 * Math.sin((t - mind.offerAt) / 520)
      : 0;
    face.time = t / 1000;

    breath += dt * (out.phase === 'asleep' ? 1.5 : 2.4);
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

    const state: BodyState = {
      x: body.x,
      y: body.y,
      scale,
      face: body.face,
      tilt: body.tilt,
      pose: body.drawPose(),
      walk: body.walk,
      phase: body.phase,
      time: t / 1000,
      breath,
      tail: {
        wave:
          out.phase === 'asleep' ? 0.03 : body.mode === 'walk' ? 0.14 : 0.09,
        lash: out.hunting * 0.35 + (body.wiggle > 0 ? 0.25 : 0),
      },
      swat: swat ? { at: [swat.x, swat.y], weight: swatWeight } : undefined,
    };
    const sk = skeleton(state);
    lastSkeleton = sk;

    // Idle frames can run at half rate; motion runs every frame.
    const moving =
      body.mode !== 'rest' ||
      t - lastInput < 1500 ||
      swat ||
      purring ||
      out.offering;
    if (moving || t - lastDraw > 32) {
      paint(sk);
      lastDraw = t;
    }

    for (const link of navLinks)
      link.classList.toggle(
        'is-near',
        body.surface === 'floor' &&
          body.mode === 'rest' &&
          Math.abs((navAt.get(link)?.[0] ?? -1e4) - body.x) < 30 * scale,
      );

    dim += ((out.dim ? 0.1 : 0) - dim) * ease(out.dim ? 0.6 : 5);
    if (dimEl) dimEl.style.opacity = dim.toFixed(3);
    const friendBlink = t < friendUntil ? 1 - out.closure * 0.92 : 1;
    for (const f of friendEyes)
      f.el.setAttribute(
        'transform',
        `${f.base} scale(1 ${friendBlink.toFixed(3)})`,
      );

    sky.frame(t, dt, false);
    if (!document.hidden) frame = requestAnimationFrame(tick);
  }

  function paint(sk: Skeleton) {
    if (lastBox) {
      ctx.clearRect(
        lastBox.x0 - 8,
        lastBox.y0 - 8,
        lastBox.x1 - lastBox.x0 + 16,
        lastBox.y1 - lastBox.y0 + 16,
      );
    }
    drawCat(ctx, sk, face, { focus: petFocus });
    lastBox = { ...sk.box };
  }

  // ---------- reduced motion: a still portrait ----------

  function staticFrame(petted = false) {
    measure();
    body.setSurfaces(surfaces, scale);
    body.place('perch', home, 'sit');
    const target = lookTarget(now(), lastSkeleton);
    const sk0 = skeleton({
      x: body.x,
      y: body.y,
      scale,
      face: body.face,
      tilt: 0,
      pose: body.pose,
      walk: 0,
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
    face.open = petted ? 0.12 : 0.74;
    face.pupil = 0.4;
    face.ears = [0, 0];
    face.shiver = 0;
    face.glow = 0;
    face.roll = 0;
    lastSkeleton = sk0;
    ctx.clearRect(0, 0, width, height);
    drawCat(ctx, sk0, face, { focus: petFocus });
    lastBox = { ...sk0.box };
    sky.frame(now(), 0, true);
    if (petted) setTimeout(() => staticFrame(false), 1400);
  }

  // ---------- lifecycle ----------

  function relayout() {
    width = innerWidth;
    height = innerHeight;
    ctx = fit(catCanvas!, width, height);
    lastBox = null;
    sky.resize();
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

  sky.resize();
  if (reduced()) staticFrame();
  else run();
}
