import { dartScore, gazeOffset, nearerEar, type Sample } from './gaze';
import {
  eyeAperture,
  headPath,
  innerEarPath,
  pupilSize,
  whiskerRoots,
  type EarPose,
} from './geometry';
import { CatMind, type MindEvent } from './mind';
import { createSky } from './sky';
import { clamp, spring, stepSpring, type Spring } from './spring';

/** Eye centres in the eyes box (`viewBox="-130 -42 260 84"`). */
const EYE_X = 66;
const EYE_Y = 2;
const EYE_TILT = 5;
const SIDES = [-1, 1] as const;

type Point = { x: number; y: number };
type InterestKind = 'nav' | 'moon' | 'contact';

const smooth = (t: number) => {
  const u = clamp(t);
  return u * u * (3 - 2 * u);
};

export function mountAwake(root: HTMLElement) {
  const $ = <T extends Element>(selector: string) =>
    root.querySelector<T>(selector);
  const $$ = <T extends Element>(selector: string) => [
    ...root.querySelectorAll<T>(selector),
  ];
  const body = $<HTMLElement>('[data-awake-body]');
  const headSvg = $<SVGSVGElement>('[data-awake-head]');
  const eyesEl = $<HTMLElement>('[data-awake-eyes]');
  const eyesSvg = eyesEl?.querySelector('svg');
  const skyCanvas = document.querySelector<HTMLCanvasElement>(
    '[data-awake-sky-canvas]',
  );
  const fxCanvas = $<HTMLCanvasElement>('[data-awake-fx]');
  if (!body || !headSvg || !eyesEl || !eyesSvg || !skyCanvas || !fxCanvas)
    return;

  const shapes = $$<SVGPathElement>('[data-awake-shape]');
  const innerEars = SIDES.map((s) =>
    $<SVGPathElement>(`[data-awake-inner="${s}"]`),
  );
  const whiskers = $$<SVGGElement>('[data-awake-whisker]').map((el) => ({
    el,
    path: el.querySelector('path')!,
    side: Number(el.dataset.awakeWhisker) as 1 | -1,
    i: Number(el.dataset.i),
    x: 0,
    y: 0,
    phase: Math.random() * Math.PI * 2,
    last: '',
  }));
  const eyes = SIDES.map((side) => {
    const g = eyesSvg.querySelector<SVGGElement>(`[data-eye="${side}"]`)!;
    return {
      side,
      clip: eyesSvg.querySelector<SVGPathElement>(`[data-eye-clip="${side}"]`)!,
      lid: g.querySelector<SVGPathElement>('[data-eye-lid]')!,
      lower: g.querySelector<SVGPathElement>('[data-eye-lower]')!,
      crease: g.querySelector<SVGPathElement>('[data-eye-crease]')!,
      shade: g.querySelector<SVGPathElement>('[data-eye-shade]')!,
      halo: g.querySelector<SVGPathElement>('[data-eye-halo]')!,
      iris: g.querySelector<SVGGElement>('[data-eye-iris]')!,
      pupil: g.querySelector<SVGEllipseElement>('[data-eye-pupil]')!,
      glint: g.querySelector<SVGGElement>('[data-eye-glint]')!,
      gx: spring(0, 300, 0.74),
      gy: spring(0, 300, 0.74),
      lastLid: '',
    };
  });
  const nose = $<SVGSVGElement>('[data-awake-nose]');
  const paw = $<SVGSVGElement>('[data-awake-paw]');
  const claws = $<SVGPathElement>('[data-awake-claws]');
  const live = $<HTMLElement>('[data-awake-live]');
  const dimEl = $<HTMLElement>('[data-awake-dim]');
  const moon = $<HTMLElement>('[data-awake-moon]');
  const navLinks = $$<HTMLAnchorElement>('[data-home-nav]');
  const contacts = $$<HTMLAnchorElement>('[data-awake-contact]');
  const friendEyes = [
    ...document.querySelectorAll<SVGGElement>('[data-awake-friend-eye]'),
  ].map((el) => ({ el, base: el.getAttribute('transform') ?? '' }));

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  // The eyes are the cat: make them a real control for keyboard users.
  eyesEl.setAttribute('role', 'button');
  eyesEl.tabIndex = 0;
  const setEyesLabel = (offer: boolean) =>
    eyesEl.setAttribute(
      'aria-label',
      offer
        ? 'the cat is slow-blinking at you. press to blink back'
        : 'the cat. press to pet it',
    );
  setEyesLabel(false);
  root.classList.add('is-live');

  const sky = createSky(skyCanvas, fxCanvas);
  const born = performance.now();
  const mind = new CatMind(born);

  // ---------- layout (measured on resize, never inside a frame) ----------
  const layout = {
    W: 0,
    H: 0,
    body: { x: 0, y: 0 },
    eyes: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ] as Point[],
    head: { x: 0, y: 0 },
    targets: new Map<Element, Point>(),
  };

  let earsDirty = true;
  function measure() {
    const saved = body!.style.transform;
    body!.style.transform = 'none';
    const sx = window.scrollX;
    const sy = window.scrollY;
    const b = body!.getBoundingClientRect();
    layout.W = body!.offsetWidth;
    layout.H = body!.offsetHeight;
    layout.body = { x: b.left + sx, y: b.top + sy };
    layout.head = {
      x: b.left + sx + b.width / 2,
      y: b.top + sy + b.height * 0.45,
    };
    const r = eyesSvg!.getBoundingClientRect();
    const scale = r.width / 260;
    layout.eyes = SIDES.map((side) => ({
      x: r.left + sx + (130 + side * EYE_X) * scale,
      y: r.top + sy + (42 + EYE_Y) * scale,
    }));
    for (const el of [...navLinks, ...contacts, ...(moon ? [moon] : [])]) {
      const t = el.getBoundingClientRect();
      layout.targets.set(el, {
        x: t.left + sx + t.width / 2,
        y: t.top + sy + t.height / 2,
      });
    }
    body!.style.transform = saved;
    const { W, H } = layout;
    headSvg!.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const length = W * 0.27;
    const roots = whiskerRoots(W, H);
    for (const w of whiskers) {
      w.x = w.side > 0 ? W - 8 : 8;
      w.y = roots[w.i]!.y;
      w.path.setAttribute(
        'd',
        `M0 0Q${(length * 0.5).toFixed(1)} -4 ${length.toFixed(1)} ${2 + w.i * 2}`,
      );
      w.last = '';
    }
    earsDirty = true;
    sky.resize();
  }

  // ---------- springs ----------
  const ears = SIDES.map(() => ({
    rot: spring(0.55, 240, 0.32),
    len: spring(0.7, 220, 0.45),
  }));
  const lid = spring(1, 150, 0.85);
  const smile = spring(0, 90, 0.9);
  const dilation = spring(0.32, 70, 0.9);
  const crouch = spring(0, 200, 0.55);
  const tilt = spring(0, 90, 0.55);
  const lungeX = spring(0, 260, 0.5);
  const lungeY = spring(0, 260, 0.5);
  const pawExt = spring(0, 420, 0.5);
  const shiver = spring(0, 40, 1);
  const dim = spring(0, 5, 1);
  const faceX = spring(0, 120, 0.8);
  const faceY = spring(0, 120, 0.8);
  const all: Spring[] = [
    lid,
    smile,
    dilation,
    crouch,
    tilt,
    lungeX,
    lungeY,
    pawExt,
    shiver,
    dim,
    faceX,
    faceY,
    ...eyes.flatMap((e) => [e.gx, e.gy]),
    ...ears.flatMap((e) => [e.rot, e.len]),
  ];

  // ---------- input ----------
  let pointer: Point | null = null;
  let pointerAt = -Infinity;
  let touchEndedAt = -Infinity;
  let touching = false;
  let lastInput = born;
  const samples: Sample[] = [];
  let interest: { el: Element; kind: InterestKind } | null = null;
  let interestUntil = Infinity;
  let friendUntil = -Infinity;
  let perkUntil = -Infinity;
  let pounceAt = -Infinity;
  let pounceTarget: Point | null = null;
  let modality: 'mouse' | 'touch' | 'keyboard' = coarse ? 'touch' : 'mouse';
  let glance: { x: number; y: number; until: number } | null = null;
  let nextGlance = born + 5000;
  let micro = { x: 0, y: 0 };
  let nextMicro = born + 1500;
  let nextTwitch = born + 4000;
  let swipe = {
    side: 1 as 1 | -1,
    angle: Math.PI / 2,
    reach: 0,
    at: -Infinity,
    hit: false,
  };
  let announcedOffer = false;
  let wasOffering = false;
  let lastHalo = '';

  const now = () => performance.now();
  function stir() {
    lastInput = now();
    if (mind.stir(lastInput)) wake();
    run();
  }

  function setInterest(el: Element | null, kind?: InterestKind, ms?: number) {
    interest = el && kind ? { el, kind } : null;
    interestUntil = ms ? now() + ms : Infinity;
    if (kind === 'moon') friendUntil = Infinity;
    stir();
  }

  function track(x: number, y: number) {
    const t = now();
    pointer = { x, y };
    pointerAt = t;
    samples.push({ x, y, t });
    if (samples.length > 64) samples.splice(0, samples.length - 64);
    stir();
  }

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      modality = 'mouse';
      track(e.clientX, e.clientY);
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget && e.pointerType !== 'touch') pointer = null;
  });
  // Touch is tracked with touch events: pointer events stop as soon as the
  // browser claims a pan, but the eyes should keep following the finger.
  const onTouch = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    modality = 'touch';
    touching = true;
    track(touch.clientX, touch.clientY);
  };
  addEventListener('touchstart', onTouch, { passive: true });
  addEventListener('touchmove', onTouch, { passive: true });
  addEventListener(
    'touchend',
    () => {
      touching = false;
      touchEndedAt = now();
    },
    { passive: true },
  );
  let typed = '';
  addEventListener('keydown', (e) => {
    if (e.key === 'Tab') modality = 'keyboard';
    typed = (typed + (e.key.length === 1 ? e.key.toLowerCase() : ' ')).slice(
      -8,
    );
    // Call it like a cat: "pspsps".
    if (typed.endsWith('psps')) {
      typed = '';
      perkUntil = now() + 2600;
    }
    stir();
  });
  addEventListener('scroll', () => stir(), { passive: true });

  for (const link of navLinks) {
    link.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') setInterest(link, 'nav');
    });
    link.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && interest?.el === link) setInterest(null);
    });
    link.addEventListener('pointerdown', () => setInterest(link, 'nav', 1600));
    link.addEventListener('focus', () => setInterest(link, 'nav'));
    link.addEventListener('blur', () => {
      if (interest?.el === link) setInterest(null);
    });
    link.addEventListener('click', (e) => {
      if (
        reduced ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      // Pounce toward the page you picked, then go.
      e.preventDefault();
      setInterest(link, 'nav');
      pounceAt = now();
      pounceTarget = layout.targets.get(link) ?? null;
      const href = link.href;
      setTimeout(() => location.assign(href), 340);
    });
  }
  for (const link of contacts) {
    link.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') setInterest(link, 'contact');
    });
    link.addEventListener('pointerleave', () => {
      if (interest?.el === link) setInterest(null);
    });
    link.addEventListener('focus', () => setInterest(link, 'contact'));
    link.addEventListener('blur', () => {
      if (interest?.el === link) setInterest(null);
    });
  }
  if (moon) {
    moon.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') setInterest(moon, 'moon');
    });
    moon.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      if (interest?.el === moon) setInterest(null);
      friendUntil = now() + 2400;
    });
    moon.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      setInterest(moon, 'moon', 2800);
      friendUntil = now() + 3400;
    });
  }
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    pounceAt = -Infinity;
    setInterest(null);
  });

  body.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) return;
    if (getSelection()?.toString()) return;
    poke();
  });
  eyesEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    modality = 'keyboard';
    poke();
  });

  function poke() {
    if (reduced) return portraitPat();
    const t = now();
    lastInput = t;
    if (mind.poke(t) === 'wake') wake();
    run();
  }

  // ---------- reactions ----------
  function wake() {
    const s = Math.random() < 0.5 ? 0 : 1;
    ears[s]!.rot.v += 9;
    ears[1 - s]!.rot.v += 3;
    dilation.v += 4;
  }

  function eyesMid(): Point {
    return {
      x: (layout.eyes[0]!.x + layout.eyes[1]!.x) / 2 - window.scrollX,
      y: layout.eyes[0]!.y - window.scrollY,
    };
  }

  function say(text: string) {
    if (live) live.textContent = text;
  }

  function pawAnchor(side: 1 | -1): Point {
    const { W, H } = layout;
    return { x: W / 2 + side * W * 0.2, y: H - W * 0.12 };
  }

  function handle(event: MindEvent, t: number) {
    const mid = eyesMid();
    const W = layout.W;
    if (event === 'offer' && !announcedOffer) {
      announcedOffer = true;
      say('the cat slow-blinks at you. that is cat for “i trust you”.');
    }
    if (event === 'exchange')
      say('you blinked back. the cat blinks again, and purrs.');
    if (event === 'purr') {
      // The purr: whiskers shiver and slow rings roll out across the sky.
      shiver.target = 1;
      for (let i = 0; i < 4; i++)
        sky.ring(mid.x, mid.y + W * 0.1, 1, i * 420, t);
      ears[0]!.len.v -= 1.2;
      ears[1]!.len.v -= 1.2;
    }
    if (event === 'pet') {
      shiver.v += 6;
      sky.ring(mid.x, mid.y + W * 0.1, 0.6, 0, t);
      ears[Math.random() < 0.5 ? 0 : 1]!.rot.v -= 6;
    }
    if (event === 'swipe' && pointer) {
      const side: 1 | -1 = pointer.x >= mid.x ? 1 : -1;
      const anchor = pawAnchor(side);
      const ax = layout.body.x - window.scrollX + anchor.x;
      const ay = layout.body.y - window.scrollY + anchor.y;
      let angle = Math.atan2(pointer.y - ay, pointer.x - ax);
      const [lo, hi] = side > 0 ? [-0.3, 1.9] : [1.24, Math.PI + 0.3];
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      angle = Math.min(hi, Math.max(lo, angle));
      swipe = {
        side,
        angle,
        reach: Math.min(
          Math.max(Math.hypot(pointer.x - ax, pointer.y - ay), W * 0.24),
          W * 0.36,
        ),
        at: t,
        hit: false,
      };
      pawExt.target = 1;
    }
    if (event === 'wake') wake();
  }

  // ---------- frame ----------
  let raf = 0;
  let last = born;
  let lastHead = '';
  let lastBody = '';
  let lastHeadT = '';
  let lastFace = '';
  let lastLit = -1;
  let lastDim = -1;

  function run() {
    if (!raf && !document.hidden && !reduced)
      raf = requestAnimationFrame(frame);
  }

  function frame(t: number) {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    const quietFor = t - lastInput;
    if (interest && t > interestUntil) interest = null;
    if (!touching && pointer && modality === 'touch' && t - touchEndedAt > 1400)
      pointer = null;

    const out = mind.tick({
      now: t,
      quietFor,
      dart: dartScore(samples, t),
      interested: interest !== null || t < perkUntil,
      engaged:
        modality === 'touch'
          ? t - born > 3500
          : pointerAt > 0 || modality === 'keyboard' || t - born > 6000,
    });
    for (const event of out.events) handle(event, t);
    const mood = `${out.phase}${out.hunting > 0.5 ? ' hunting' : ''}${out.purring ? ' purring' : ''}${out.offering ? ' offering' : ''}`;
    if (root.dataset.mood !== mood) root.dataset.mood = mood;

    const mid = eyesMid();
    const sx = window.scrollX;
    const sy = window.scrollY;
    const W = layout.W;

    // Where to look: something interesting, then the pointer, then you.
    let target: Point | null = null;
    if (interest) {
      const p = layout.targets.get(interest.el);
      if (p) target = { x: p.x - sx, y: p.y - sy };
    } else if (pointer) {
      target = pointer;
    } else if (glance && t < glance.until) {
      target = glance;
    }
    // With no pointer to watch, it glances around the room now and then.
    if (
      !pointer &&
      !interest &&
      t > nextGlance &&
      quietFor > 2500 &&
      !out.purring &&
      !out.offering
    ) {
      const options = [...layout.targets.values()];
      const pick = options[Math.floor(Math.random() * options.length)];
      if (pick)
        glance = {
          x: pick.x - sx,
          y: pick.y - sy,
          until: t + 700 + Math.random() * 500,
        };
      nextGlance = t + 4500 + Math.random() * 4500;
    }
    if (t > nextMicro) {
      micro = {
        x: (Math.random() - 0.5) * 2.6,
        y: (Math.random() - 0.5) * 1.8,
      };
      nextMicro = t + 500 + Math.random() * 1300;
    }

    let near = 0;
    if (target && !interest) {
      const d = Math.hypot(target.x - mid.x, target.y - mid.y);
      near = smooth(1 - d / (W * 0.42));
    }
    let gazeX = 0;
    let gazeY = 0;
    for (const eye of eyes) {
      const i = eye.side < 0 ? 0 : 1;
      const ex = layout.eyes[i]!.x - sx;
      const ey = layout.eyes[i]!.y - sy;
      let [gx, gy] = target
        ? gazeOffset(target.x - ex, target.y - ey)
        : [0, 0.6];
      // Counter the eye's tilt so "up" means up on screen.
      const a = (EYE_TILT * eye.side * Math.PI) / 180;
      [gx, gy] = [
        gx * Math.cos(a) - gy * Math.sin(a),
        gx * Math.sin(a) + gy * Math.cos(a),
      ];
      eye.gx.target = gx + micro.x;
      eye.gy.target = gy + micro.y;
      gazeX += eye.gx.x / 2;
      gazeY += eye.gy.x / 2;
    }

    // Pupils: wide with interest or the hunt, slits up close.
    let dil = 0.34 + 0.04 * Math.sin(t / 900);
    if (interest?.kind === 'nav') dil = 0.8;
    else if (interest?.kind === 'moon') dil = 0.62;
    else if (interest?.kind === 'contact') dil = 0.56;
    if (t < perkUntil) dil = Math.max(dil, 0.72);
    if (out.purring) dil = 0.5;
    dil += (1 - dil) * out.hunting;
    dil += (0.04 - dil) * near;
    dilation.target = dil;

    lid.target =
      out.phase === 'asleep'
        ? 0
        : out.lid * (1 - 0.14 * near) + 0.06 * out.hunting;
    smile.target = out.smile;

    // Ears: follow the gaze, swivel toward interest, perk, flatten, flop.
    const settled = t - born > 300;
    const moonUp = interest?.kind === 'moon' || t < perkUntil;
    for (const [k, s] of SIDES.entries()) {
      let rot = s * (gazeX / 9) * 0.08;
      let len = 1;
      if (interest && interest.kind !== 'moon' && target) {
        if (nearerEar(target.x, mid.x) === s) {
          rot += 0.32;
          len = 1.06;
        } else rot += 0.04;
      }
      if (moonUp) {
        rot -= 0.12;
        len = 1.1;
      }
      rot += 0.5 * out.hunting;
      len += (0.86 - len) * out.hunting;
      if (out.phase === 'asleep') {
        rot += 0.2;
        len = 0.95;
      }
      ears[k]!.rot.target = settled ? rot : 0.55;
      ears[k]!.len.target = settled ? len : 0.7;
    }
    if (t > nextTwitch && out.phase === 'awake') {
      ears[Math.random() < 0.5 ? 0 : 1]!.rot.v += Math.random() < 0.5 ? 6 : -4;
      nextTwitch = t + 4000 + Math.random() * 6500;
    }

    // Body: crouch to hunt, lunge to pounce, tilt when curious.
    const pounce = t - pounceAt;
    crouch.target = Math.max(out.hunting, pounce < 120 ? 1 : 0);
    if (pounce >= 110 && pounce < 600 && pounceTarget) {
      const dx = pounceTarget.x - layout.head.x;
      const dy = pounceTarget.y - layout.head.y;
      const d = Math.hypot(dx, dy) || 1;
      lungeX.target = (dx / d) * 20;
      lungeY.target = (dy / d) * 20;
    } else {
      lungeX.target = 0;
      lungeY.target = 0;
    }
    tilt.target = t < perkUntil ? 7 : moonUp ? -3 : 0;
    shiver.target = out.purring ? 1 : 0;
    dim.target = out.dim;
    faceX.target = gazeX * 0.55;
    faceY.target = gazeY * 0.45 - crouch.x * 2;

    // Paw swipe: out fast, a beat at full reach, back under.
    if (pawExt.target === 1 && t - swipe.at > 380) pawExt.target = 0;

    for (const s of all) stepSpring(s, dt);

    // ---------- draw ----------
    const lunge = Math.hypot(lungeX.x, lungeY.x) / 20;
    const c = crouch.x;
    const bodyT = `translate(${lungeX.x.toFixed(2)}px, ${(lungeY.x + c * 6).toFixed(2)}px) rotate(${tilt.x.toFixed(2)}deg) scale(${(1 + c * 0.025 - lunge * 0.015).toFixed(4)}, ${(1 - c * 0.045 + lunge * 0.03).toFixed(4)})`;
    if (bodyT !== lastBody) {
      body!.style.transform = bodyT;
      lastBody = bodyT;
    }
    const asleep = out.phase === 'asleep';
    const breath =
      (asleep ? 0.014 : 0.008) *
      (0.5 -
        0.5 * Math.cos((2 * Math.PI * (t - born)) / (asleep ? 5600 : 4000)));
    const headT = `scale(${(1 + breath).toFixed(4)}, ${(1 + breath * 0.7).toFixed(4)})`;
    if (headT !== lastHeadT) {
      headSvg!.style.transform = headT;
      lastHeadT = headT;
    }
    const faceT = `translate(${faceX.x.toFixed(2)}px, ${faceY.x.toFixed(2)}px)`;
    if (faceT !== lastFace) {
      eyesEl!.style.transform = faceT;
      if (nose)
        nose.style.transform = `translate(${(faceX.x * 0.6).toFixed(2)}px, ${(faceY.x * 0.6).toFixed(2)}px)`;
      lastFace = faceT;
    }

    const poses: EarPose[] = ears.map((e) => ({ rot: e.rot.x, len: e.len.x }));
    const headKey = poses
      .map((p) => `${p.rot.toFixed(3)},${p.len.toFixed(3)}`)
      .join('|');
    if (earsDirty || headKey !== lastHead) {
      const d = headPath(layout.W, layout.H, poses[0], poses[1]);
      for (const shape of shapes) shape.setAttribute('d', d);
      SIDES.forEach((s, k) =>
        innerEars[k]?.setAttribute(
          'd',
          innerEarPath(layout.W, layout.H, s, poses[k]),
        ),
      );
      lastHead = headKey;
      earsDirty = false;
    }

    const whiskerBase = -7 * out.hunting + (asleep ? 6 : 0);
    for (const w of whiskers) {
      const wobble =
        shiver.x * 3.2 * Math.sin(t * 0.07 + w.phase) +
        Math.sin(t / 1400 + w.phase) * 0.8;
      const angle = w.side * ((w.i - 1) * 9 + whiskerBase + wobble);
      const tr = `translate(${w.x.toFixed(1)} ${w.y.toFixed(1)}) rotate(${angle.toFixed(2)})`;
      if (tr !== w.last) {
        w.el.setAttribute('transform', tr);
        w.last = tr;
      }
    }

    const open = clamp(lid.x * (1 - out.closure), 0, 1.08);
    const pupil = pupilSize(dilation.x);
    for (const eye of eyes) {
      const key = `${open.toFixed(3)}:${smile.x.toFixed(3)}`;
      if (key !== eye.lastLid) {
        const lids = eyeAperture({ open, smile: smile.x }, eye.side);
        eye.clip.setAttribute('d', lids.clip);
        eye.lid.setAttribute('d', lids.upper);
        eye.shade.setAttribute('d', lids.upper);
        eye.lower.setAttribute('d', lids.lower);
        eye.crease.setAttribute('d', lids.crease);
        eye.crease.style.opacity = String(clamp(open * 1.4 - 0.3));
        eye.lastLid = key;
      }
      eye.iris.setAttribute(
        'transform',
        `translate(${eye.gx.x.toFixed(2)} ${eye.gy.x.toFixed(2)})`,
      );
      eye.glint.setAttribute(
        'transform',
        `translate(${(eye.gx.x * 0.3).toFixed(2)} ${(eye.gy.x * 0.3).toFixed(2)})`,
      );
      eye.pupil.setAttribute('rx', pupil.rx.toFixed(2));
      eye.pupil.setAttribute('ry', pupil.ry.toFixed(2));
    }
    // The only cue to answer: while the cat waits, the light in its eyes
    // slowly breathes brighter.
    const invite = out.offering
      ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - mind.offerAt)) / 1700)
      : 0;
    const halo = (clamp(open) * (0.26 + 0.34 * invite)).toFixed(2);
    if (halo !== lastHalo) {
      for (const eye of eyes) eye.halo.style.opacity = halo;
      lastHalo = halo;
    }
    const lit = Math.round(clamp(open) * 50) / 50;
    if (lit !== lastLit) {
      root.style.setProperty('--awake-lit', String(lit));
      lastLit = lit;
    }
    const dimV = Math.round(dim.x * 100) / 100;
    if (dimV !== lastDim && dimEl) {
      dimEl.style.opacity = String(dimV * 0.1);
      lastDim = dimV;
    }

    // The constellation friend blinks along while the moon has their attention.
    const friendBlink = t < friendUntil ? 1 - out.closure * 0.92 : 1;
    for (const f of friendEyes)
      f.el.setAttribute(
        'transform',
        `${f.base} scale(1 ${friendBlink.toFixed(3)})`,
      );

    if (paw && claws) {
      const ext = clamp(pawExt.x, -0.2, 1.3);
      if (ext > 0.01 || paw.style.visibility !== 'hidden') {
        const anchor = pawAnchor(swipe.side);
        const pw = paw.clientWidth || W * 0.15;
        const ph = pw * 1.75;
        const swing = swipe.angle + swipe.side * (-0.55 + 0.75 * clamp(ext));
        const reach = ext * swipe.reach - ph * 0.42;
        const cx = anchor.x + Math.cos(swing) * reach;
        const cy = anchor.y + Math.sin(swing) * reach;
        paw.style.visibility = ext > 0.01 ? 'visible' : 'hidden';
        paw.style.transform = `translate(${(cx - pw / 2).toFixed(1)}px, ${(cy - ph / 2).toFixed(1)}px) rotate(${(((swing + Math.PI / 2) * 180) / Math.PI).toFixed(1)}deg)`;
        claws.style.opacity = clamp((ext - 0.55) / 0.3).toFixed(2);
        // A swipe that reaches the cursor "catches" it.
        if (!swipe.hit && ext > 0.85 && pointer) {
          const tipX =
            layout.body.x - sx + anchor.x + Math.cos(swing) * ext * swipe.reach;
          const tipY =
            layout.body.y - sy + anchor.y + Math.sin(swing) * ext * swipe.reach;
          if (Math.hypot(pointer.x - tipX, pointer.y - tipY) < 46) {
            swipe.hit = true;
            sky.sparkle(pointer.x, pointer.y, t);
          }
        }
      }
    }

    if (out.offering !== wasOffering) {
      wasOffering = out.offering;
      setEyesLabel(out.offering);
    }
    sky.frame(t, dt, false);

    if (!document.hidden && !reduced) raf = requestAnimationFrame(frame);
  }

  // ---------- reduced motion: a composed portrait ----------
  let patted = false;
  function portrait() {
    const { W, H } = layout;
    const leftEar = { rot: 0.04, len: 1.02 };
    const rightEar = { rot: 0.1, len: 1.04 };
    const d = headPath(W, H, leftEar, rightEar);
    for (const shape of shapes) shape.setAttribute('d', d);
    SIDES.forEach((s, k) =>
      innerEars[k]?.setAttribute(
        'd',
        innerEarPath(W, H, s, k ? rightEar : leftEar),
      ),
    );
    for (const w of whiskers)
      w.el.setAttribute(
        'transform',
        `translate(${w.x.toFixed(1)} ${w.y.toFixed(1)}) rotate(${w.side * ((w.i - 1) * 9 + 2)})`,
      );
    const pose = { open: patted ? 0.3 : 0.56, smile: patted ? 0.6 : 0.35 };
    const pupil = pupilSize(0.46);
    // Content, half-lidded, eyes resting on the way out: the nav.
    const nav = navLinks
      .map((el) => layout.targets.get(el))
      .filter((p): p is Point => !!p);
    const rest = nav.length
      ? {
          x: nav.reduce((a, p) => a + p.x, 0) / nav.length,
          y: Math.max(...nav.map((p) => p.y)),
        }
      : { x: layout.eyes[0]!.x + 60, y: layout.eyes[0]!.y + 300 };
    for (const eye of eyes) {
      const lids = eyeAperture(pose, eye.side);
      eye.clip.setAttribute('d', lids.clip);
      eye.lid.setAttribute('d', lids.upper);
      eye.shade.setAttribute('d', lids.upper);
      eye.lower.setAttribute('d', lids.lower);
      eye.crease.setAttribute('d', lids.crease);
      eye.crease.style.opacity = '0.25';
      eye.halo.style.opacity = '0.18';
      const i = eye.side < 0 ? 0 : 1;
      const [gx, gy] = gazeOffset(
        rest.x - layout.eyes[i]!.x,
        rest.y - layout.eyes[i]!.y,
      );
      eye.iris.setAttribute(
        'transform',
        `translate(${gx.toFixed(2)} ${gy.toFixed(2)})`,
      );
      eye.glint.setAttribute(
        'transform',
        `translate(${(gx * 0.3).toFixed(2)} ${(gy * 0.3).toFixed(2)})`,
      );
      eye.pupil.setAttribute('rx', pupil.rx.toFixed(2));
      eye.pupil.setAttribute('ry', pupil.ry.toFixed(2));
    }
    root.style.setProperty('--awake-lit', '0.5');
    body!.style.transform = '';
    headSvg!.style.transform = '';
    eyesEl!.style.transform = '';
    if (nose) nose.style.transform = '';
    sky.frame(performance.now(), 0, true);
  }

  // In the portrait, a pat still earns a contented squint.
  function portraitPat() {
    patted = true;
    portrait();
    say('the cat squints at you, content.');
  }

  function relayout() {
    measure();
    if (reduced) portrait();
  }

  relayout();
  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(relayout);
  }).observe(document.documentElement);
  // Fonts change the face's height, so measure again once they land.
  document.fonts?.ready.then(relayout);

  reducedQuery.addEventListener('change', (e) => {
    reduced = e.matches;
    if (reduced) {
      cancelAnimationFrame(raf);
      raf = 0;
      portrait();
    } else run();
  });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = now();
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    last = now();
    // It dozed while you were away; it notices you're back.
    if (now() - hiddenAt > 20_000 && !reduced) {
      mind.phase = 'asleep';
      stir();
    }
    run();
  });

  run();
}
