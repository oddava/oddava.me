import type { Rest } from './body';
import type { Phase } from './mind';
import { angleDelta, TAIL, type PawOverride, type Vec } from './rig';
import { bump, clamp, spring, stepSpring } from './spring';

/**
 * What the cat does when nobody is asking anything of it. The mind decides
 * moods and the body goes places; this layer keeps it alive in between —
 * ears that twitch and turn to listen, a tail with weight, eyes that flick
 * between things, a head that is never quite still, and small habits played
 * out at irregular intervals: grooming, yawning, a look round, a head tilt,
 * a shake, kneading, a silent meow, now and then a sneeze. Asleep, it
 * dreams.
 *
 * Pure and clock-driven like the mind: no DOM, an injectable random source.
 * Each act fades in and out on its own envelope, so a cancelled act eases
 * away instead of snapping, and two acts never fight over the same paw.
 */

export type ActKind =
  | 'groom'
  | 'yawn'
  | 'look'
  | 'tilt'
  | 'shake'
  | 'shuffle'
  | 'knead'
  | 'meow'
  | 'sneeze'
  | 'stretch'
  | 'dream';

export interface LifeInput {
  /** ms */
  now: number;
  /** s */
  dt: number;
  mode: 'rest' | 'walk' | 'windup' | 'air' | 'land' | 'held';
  /** The resting pose it is in or settling into. */
  rest: Rest;
  phase: Phase;
  hunting: number;
  purring: boolean;
  /** Its attention is taken: the pointer is busy nearby, a link, a pounce. */
  attentive: boolean;
  /** Local head and front-paw rest positions of the current pose. */
  head: Vec;
  front: Vec;
  /** Base direction and curl of the tail in the current pose (local). */
  tailAngle: number;
  tailCurl: number;
  /** World velocity (px/s, y down), scale, and which way it faces. */
  vx: number;
  vy: number;
  scale: number;
  facing: 1 | -1;
}

export interface Expression {
  /** Local units added to the pose's head position. */
  head: Vec;
  roll: number;
  pitch: number;
  /** Added to the head's turn, −1..1 screen. */
  yaw: number;
  /** Somewhere to look, as a px offset from the head; null: at the viewer. */
  glance: Vec | null;
  /** Small eye movements on top of wherever it looks, in eye units. */
  saccade: Vec;
  /** Multiplies the lid aperture. */
  open: number;
  happy: number;
  smile: number;
  squint: number;
  wide: number;
  pupil: number;
  mouth: number;
  tongue: number;
  blush: number;
  shiver: number;
  ears: [number, number];
  swivel: [number, number];
  paws: { near?: PawOverride; far?: PawOverride };
  /** A pose the act needs (the play bow), while it lasts. */
  rest?: Rest;
  /** Ask for an ordinary blink now (after a big glance, a sneeze). */
  blink: boolean;
  /** An act that began this tick, for anything that wants to answer it. */
  started: ActKind | null;
}

interface Act {
  kind: ActKind;
  start: number;
  duration: number;
  /** Per-act variety: a side, a tempo, a sequence of glances. */
  side: 1 | -1;
  tempo: number;
  glances: { at: number; to: Vec | null }[];
  /** Set when it is cut short; the envelope releases from here. */
  cancelAt: number;
  /** One-off cues already sent (a blink at the end of a yawn). */
  cued: boolean;
}

const ATTACK = 260;
const RELEASE = 320;

/** Smooth 0→1 between `a` and `b`. */
function ramp(u: number, a: number, b: number) {
  const t = clamp((u - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 1 between `a` and `b`, with smooth edges `edge` wide. */
function hold(u: number, a: number, b: number, edge: number) {
  return ramp(u, a, a + edge) * (1 - ramp(u, b - edge, b));
}

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in −1..1; two octaves so it never looks periodic. */
export function noise(t: number, seed = 0) {
  const one = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = hash(i + seed * 57.3);
    const b = hash(i + 1 + seed * 57.3);
    return (a + (b - a) * u) * 2 - 1;
  };
  return one(t) * 0.7 + one(t * 2.3 + 17) * 0.3;
}

/**
 * A tail as a chain of segments, each a damped spring toward its rest angle
 * plus whatever the segment before it is doing. A change at the root rolls
 * out to the tip a beat later — the whip of a real tail — and the body's
 * acceleration swings it.
 */
export class TailChain {
  angles: number[];
  private vel: number[];

  constructor(targets: readonly number[]) {
    this.angles = [...targets];
    this.vel = targets.map(() => 0);
  }

  /** Nudge the outer segments (a flick of the tip). */
  flick(amount: number) {
    const n = this.vel.length;
    for (let i = 0; i < n; i++) this.vel[i]! += amount * ((i + 1) / n) ** 2.2;
  }

  /** `accel` is the body's acceleration in local units/s², y up. */
  step(targets: readonly number[], dt: number, accel: Vec, loose = 0) {
    const n = targets.length;
    if (this.angles.length !== n) {
      this.angles = [...targets];
      this.vel = targets.map(() => 0);
    }
    let left = Math.min(Math.max(dt, 0), 0.064);
    while (left > 1e-9) {
      const h = Math.min(1 / 240, left);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        // The tip is softer and slower to settle than the root.
        const w = (17 - 9 * k) * (1 - 0.35 * loose);
        const zeta = 0.62 - 0.26 * k;
        const lead =
          i === 0 ? 0 : angleDelta(targets[i - 1]!, this.angles[i - 1]!) * 0.92;
        const goal = targets[i]! + lead;
        const a = this.angles[i]!;
        const swing =
          ((accel[0] * Math.sin(a) - accel[1] * Math.cos(a)) / 46) *
          (0.4 + 0.6 * k);
        this.vel[i]! +=
          (w * w * angleDelta(a, goal) - 2 * zeta * w * this.vel[i]! + swing) *
          h;
        this.angles[i]! += this.vel[i]! * h;
      }
      left -= h;
    }
    return this.angles;
  }
}

/** Every act a context can choose, with its relative weight. */
function menu(input: LifeInput): [ActKind, number][] {
  if (input.phase === 'asleep') return [['dream', 1]];
  if (input.phase === 'drowsy')
    return [
      ['yawn', 2],
      ['look', 0.4],
      ['shuffle', input.rest === 'sit' ? 0.5 : 0],
    ];
  switch (input.rest) {
    case 'sit':
      return [
        ['look', 4],
        ['groom', 2.2],
        ['shuffle', 1.5],
        ['tilt', 1.2],
        ['yawn', 0.8],
        ['stretch', 0.55],
        ['knead', input.purring ? 3 : 0.4],
        ['meow', 0.35],
        ['shake', 0.3],
        ['sneeze', 0.12],
      ];
    case 'stand':
      return [
        ['look', 3],
        ['tilt', 1],
        ['stretch', 0.8],
        ['yawn', 0.5],
        ['shake', 0.5],
        ['meow', 0.3],
        ['sneeze', 0.1],
      ];
    case 'loaf':
      return [
        ['look', 2.5],
        ['yawn', 1.2],
        ['tilt', 0.6],
        ['sneeze', 0.08],
      ];
    default:
      return [];
  }
}

/** Acts that need the visitor to be elsewhere; the others carry on regardless. */
const PRIVATE: ReadonlySet<ActKind> = new Set([
  'groom',
  'look',
  'stretch',
  'knead',
  'shuffle',
]);

export class CatLife {
  readonly tail: TailChain;
  private readonly rand: () => number;
  private acts: Act[] = [];
  private nextAct: number;
  private recent: ActKind[] = [];
  private queued: { kind: ActKind; at: number }[] = [];
  private ears = [spring(0, 760, 0.3), spring(0, 760, 0.3)];
  private swivels = [spring(0, 120, 0.7), spring(0, 120, 0.7)];
  private nextTwitch: [number, number];
  private nextListen: number;
  private listenUntil = -Infinity;
  private listenSide = 0;
  private saccade: Vec = [0, 0];
  private nextSaccade = 0;
  private nextFlick: number;
  private wavePhase = 0;
  private lashPhase = 0;
  private lastVx = 0;
  private lastVy = 0;
  private lastGlance: Vec | null = null;
  private seed: number;
  private primed = false;
  private justStarted: ActKind | null = null;

  constructor(now: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.seed = rand() * 100;
    this.nextAct = now + 2600 + rand() * 2400;
    this.nextTwitch = [now + this.gap(5000), now + this.gap(5000)];
    this.nextListen = now + this.gap(9000);
    this.nextFlick = now + this.gap(4000);
    this.tail = new TailChain(new Array(TAIL.segments).fill(Math.PI));
  }

  /** An exponential wait with mean `mean` ms, never shorter than a third of it. */
  private gap(mean: number) {
    return mean / 3 + -Math.log(1 - this.rand() * 0.999) * mean * 0.67;
  }

  /** The act running now, if any. */
  get current(): ActKind | null {
    const act = this.acts.find((a) => a.cancelAt === Infinity);
    return act ? act.kind : null;
  }

  /** Busy enough that every frame should be drawn. */
  get lively() {
    return this.acts.length > 0;
  }

  /** Ask for an act (a reaction): it starts as soon as nothing else is playing. */
  trigger(kind: ActKind, now: number, delay = 0) {
    if (this.queued.some((q) => q.kind === kind)) return;
    this.queued.push({ kind, at: now + delay });
  }

  /** A sound: one or both ears snap round toward it. */
  hear(side: 1 | -1 | 0, now: number) {
    for (const i of side === 0 ? [0, 1] : [side < 0 ? 0 : 1]) {
      this.ears[i]!.v += 9 + this.rand() * 6;
    }
    this.listenSide = side;
    this.listenUntil = now + 500 + this.rand() * 700;
  }

  private start(kind: ActKind, input: LifeInput) {
    const { now } = input;
    const r = this.rand;
    const side: 1 | -1 = r() < 0.5 ? -1 : 1;
    const tempo = 0.85 + r() * 0.3;
    let duration = 1000;
    const glances: Act['glances'] = [];
    switch (kind) {
      case 'groom':
        duration = 4600 + r() * 2600;
        break;
      case 'yawn':
        duration = 2400 + r() * 600;
        break;
      case 'look': {
        const n = 2 + Math.floor(r() * 3);
        let at = 0;
        const k = input.scale;
        for (let i = 0; i < n; i++) {
          const pick = r();
          const s = r() < 0.5 ? -1 : 1;
          let to: Vec | null;
          if (pick < 0.4)
            to = [s * (180 + r() * 220) * k, (-90 + r() * 110) * k];
          else if (pick < 0.65)
            to = [s * (40 + r() * 180) * k, -(170 + r() * 170) * k];
          else if (pick < 0.8) to = [s * (60 + r() * 120) * k, 50 * k];
          else to = null;
          glances.push({ at, to });
          at += 700 + r() * 1300;
        }
        duration = at + 300;
        break;
      }
      case 'tilt':
        duration = 1500 + r() * 900;
        break;
      case 'shake':
        duration = 620 + r() * 160;
        break;
      case 'shuffle':
        duration = 900 + r() * 400;
        break;
      case 'knead':
        duration = 2600 + r() * 1800;
        break;
      case 'meow':
        duration = 700 + r() * 250;
        break;
      case 'sneeze':
        duration = 1500;
        break;
      case 'stretch':
        duration = 3400 + r() * 900;
        break;
      case 'dream':
        duration = 700 + r() * 600;
        break;
    }
    this.acts.push({
      kind,
      start: now,
      duration,
      side,
      tempo,
      glances,
      cancelAt: Infinity,
      cued: false,
    });
    this.recent = [kind, ...this.recent].slice(0, 3);
    this.justStarted = kind;
  }

  /** Whether `kind` can run in this moment. */
  private allowed(kind: ActKind, input: LifeInput) {
    if (input.mode !== 'rest' || input.hunting > 0.05) return false;
    if (kind === 'dream') return input.phase === 'asleep';
    if (input.phase === 'asleep') return false;
    if (input.attentive && PRIVATE.has(kind)) return false;
    if (
      (kind === 'groom' || kind === 'shuffle' || kind === 'knead') &&
      input.rest !== 'sit'
    )
      return false;
    if (kind === 'stretch' && input.rest === 'loaf') return false;
    return true;
  }

  private choose(input: LifeInput): ActKind | null {
    const options = menu(input).filter(
      ([kind, w]) => w > 0 && this.allowed(kind, input),
    );
    let total = 0;
    const weighted = options.map(([kind, w]) => {
      // Habits, not loops: what it just did is less likely to come next.
      const i = this.recent.indexOf(kind);
      const recency = i === 0 ? 0.15 : i === 1 ? 0.45 : i === 2 ? 0.75 : 1;
      total += w * recency;
      return [kind, w * recency] as const;
    });
    let pick = this.rand() * total;
    for (const [kind, w] of weighted) {
      pick -= w;
      if (pick <= 0) return kind;
    }
    return null;
  }

  tick(input: LifeInput): Expression {
    const { now, dt } = input;
    const r = this.rand;
    const awake = input.phase !== 'asleep';

    // ---- acts: cancel what no longer fits, start what's due ----
    for (const act of this.acts) {
      if (act.cancelAt !== Infinity) continue;
      const over = now >= act.start + act.duration;
      if (over || !this.allowed(act.kind, input)) {
        act.cancelAt = over ? act.start + act.duration : now;
        if (over && act.kind === 'sneeze') this.trigger('shake', now, 120);
        if (over && act.kind === 'groom' && r() < 0.4)
          this.trigger('shake', now, 200);
        if (over && act.kind === 'stretch' && r() < 0.5)
          this.trigger('shake', now, 300);
      }
    }
    this.acts = this.acts.filter(
      (a) => a.cancelAt === Infinity || now < a.cancelAt + RELEASE,
    );
    const running = this.acts.some((a) => a.cancelAt === Infinity);
    if (!running) {
      const due = this.queued.findIndex((q) => now >= q.at);
      if (due >= 0) {
        const { kind } = this.queued[due]!;
        if (this.allowed(kind, input)) {
          this.queued.splice(due, 1);
          this.start(kind, input);
          this.nextAct = Math.max(this.nextAct, now + 1500);
        } else if (now > this.queued[due]!.at + 2500) {
          this.queued.splice(due, 1);
        }
      } else if (now >= this.nextAct) {
        const kind = this.choose(input);
        if (kind) this.start(kind, input);
        const mean = input.phase === 'asleep' ? 5200 : 3400;
        this.nextAct = now + (kind ? 1200 : 0) + this.gap(mean);
      }
    }
    if (input.mode !== 'rest') this.nextAct = Math.max(this.nextAct, now + 900);

    const ex: Expression = {
      head: [0, 0],
      roll: 0,
      pitch: 0,
      yaw: 0,
      glance: null,
      saccade: [0, 0],
      open: 1,
      happy: 0,
      smile: 0,
      squint: 0,
      wide: 0,
      pupil: 0,
      mouth: 0,
      tongue: 0,
      blush: 0,
      shiver: 0,
      ears: [0, 0],
      swivel: [0, 0],
      paws: {},
      blink: false,
      started: this.justStarted,
    };
    this.justStarted = null;

    for (const act of this.acts) {
      const u = now - act.start;
      const end = Math.min(act.start + act.duration, act.cancelAt);
      const env = ramp(u, 0, ATTACK) * (1 - ramp(now, end, end + RELEASE));
      if (env > 0) this.play(act, u, env, input, ex);
    }

    // ---- ears: twitches, listening ----
    for (const i of [0, 1] as const) {
      if (now >= this.nextTwitch[i]) {
        const kick = (awake ? 1 : 0.6) * (12 + r() * 12);
        this.ears[i]!.v -= kick;
        if (r() < 0.28) this.ears[1 - i]!.v -= kick * 0.6;
        this.nextTwitch[i] =
          now + this.gap(input.phase === 'awake' ? 7500 : 6000);
      }
      stepSpring(this.ears[i]!, dt);
    }
    if (awake && now >= this.nextListen) {
      this.listenSide = r() < 0.5 ? -1 : 1;
      this.listenUntil = now + 600 + r() * 1800;
      this.nextListen = now + this.gap(9000);
    }
    const listening = now < this.listenUntil;
    for (const i of [0, 1] as const) {
      const sideHit =
        this.listenSide === 0 ||
        (i === 0 ? this.listenSide < 0 : this.listenSide > 0);
      this.swivels[i]!.target = listening && sideHit ? 0.75 : 0;
      stepSpring(this.swivels[i]!, dt);
      ex.ears[i] += this.ears[i]!.x * 0.8;
      ex.swivel[i] += Math.max(0, this.swivels[i]!.x);
    }

    // ---- the head is never quite still ----
    const t = now / 1000;
    const calm = awake ? 1 : 0.25;
    ex.roll += 0.03 * noise(t * 0.28, this.seed) * calm;
    ex.pitch += 0.06 * noise(t * 0.21, this.seed + 1) * calm;
    ex.head[0] += 0.6 * noise(t * 0.24, this.seed + 2) * calm;
    ex.head[1] += 0.4 * noise(t * 0.31, this.seed + 3) * calm;
    ex.yaw += 0.05 * noise(t * 0.17, this.seed + 4) * calm;

    // ---- eyes: small jumps between points of interest ----
    if (now >= this.nextSaccade) {
      const reach = input.attentive ? 0.18 : 0.38;
      this.saccade = [(r() * 2 - 1) * reach, (r() * 2 - 1) * reach * 0.7];
      this.nextSaccade = now + 380 + r() * (input.attentive ? 900 : 2000);
    }
    ex.saccade = awake ? this.saccade : [0, 0];
    if (ex.glance && !this.lastGlance) ex.blink = r() < 0.3;
    if (ex.glance && this.lastGlance) {
      const jump = Math.hypot(
        ex.glance[0] - this.lastGlance[0],
        ex.glance[1] - this.lastGlance[1],
      );
      if (jump > 150 * input.scale) ex.blink = r() < 0.45;
    }
    this.lastGlance = ex.glance;

    // ---- tail ----
    this.stepTail(input);
    return ex;
  }

  private stepTail(input: LifeInput) {
    const { dt, now } = input;
    const r = this.rand;
    const t = now / 1000;
    const asleep = input.phase === 'asleep';
    let wave = asleep
      ? 0.025
      : 0.06 + 0.06 * (noise(t * 0.13, this.seed + 5) + 1);
    let lash = input.hunting * 0.38;
    let hook = 0;
    let loose = 0;
    if (input.mode === 'walk') {
      wave = 0.1;
      hook = 0.75;
    }
    if (input.mode === 'held') {
      wave = 0.32;
      lash = 0.25;
      loose = 1;
    }
    if (input.purring) hook = Math.max(hook, 0.35);
    // Tempo drifts, so the sway never settles into a metronome.
    this.wavePhase += dt * (1.5 + 0.5 * noise(t * 0.1, this.seed + 6));
    this.lashPhase += dt * 7.2;
    const n = TAIL.segments;
    const targets: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const sway =
        Math.sin(this.wavePhase - i * 0.42) * wave * (0.35 + 0.65 * k) +
        Math.sin(this.lashPhase - i * 0.6) * lash * k * k;
      const crook = hook * Math.max(0, (k - 0.62) / 0.38) * 1.6;
      targets.push(input.tailAngle + input.tailCurl * k + sway + crook);
    }
    // A flick of the tip now and then; often when something has its interest.
    if (now >= this.nextFlick) {
      const mean = asleep ? 9000 : input.attentive ? 1800 : 4600;
      this.tail.flick((r() < 0.5 ? -1 : 1) * (asleep ? 4 : 7 + r() * 7));
      this.nextFlick = now + this.gap(mean);
    }
    // Acceleration in local units, y up, x the way it faces.
    const k = input.scale || 1;
    const ax = dt > 0 ? (input.vx - this.lastVx) / dt / k : 0;
    const ay = dt > 0 ? -(input.vy - this.lastVy) / dt / k : 0;
    this.lastVx = input.vx;
    this.lastVy = input.vy;
    const accel: Vec = [
      Math.max(-4000, Math.min(4000, ax * input.facing)),
      Math.max(-4000, Math.min(4000, ay)),
    ];
    if (!this.primed) {
      this.primed = true;
      this.tail.angles = [...targets];
    }
    this.tail.step(targets, dt, accel, loose);
  }

  /** One act's contribution at `u` ms in, weighted by its envelope. */
  private play(
    act: Act,
    u: number,
    env: number,
    input: LifeInput,
    ex: Expression,
  ) {
    const D = act.duration;
    const f = input.facing;
    const nearEar = f > 0 ? 1 : 0;
    const add = (
      key:
        | 'roll'
        | 'pitch'
        | 'yaw'
        | 'happy'
        | 'smile'
        | 'squint'
        | 'wide'
        | 'pupil'
        | 'mouth'
        | 'tongue'
        | 'blush'
        | 'shiver',
      v: number,
    ) => {
      ex[key] += v * env;
    };
    const shut = (amount: number) => {
      ex.open *= 1 - clamp(amount) * env;
    };
    const head = (dx: number, dy: number) => {
      ex.head[0] += dx * env;
      ex.head[1] += dy * env;
    };
    const ears = (l: number, rr: number) => {
      ex.ears[0] += l * env;
      ex.ears[1] += rr * env;
    };
    const swivel = (l: number, rr: number) => {
      ex.swivel[0] += l * env;
      ex.swivel[1] += rr * env;
    };
    const [hx, hy] = input.head;
    const [fx] = input.front;

    switch (act.kind) {
      case 'groom': {
        const licking = hold(u, 380, D * 0.62, 220);
        const wiping = hold(u, D * 0.6, D - 420, 240);
        const raised = hold(u, 0, D, 420);
        const hz = 2.6 * act.tempo;
        const phase = (u / 1000) * hz * Math.PI * 2;
        const stroke = (Math.sin(phase) + 1) / 2;
        let paw: Vec = [hx + 7, hy - 17 + stroke * 1.6 * licking];
        // Wipes: the paw sweeps up over the cheek toward the ear, twice.
        const wipeU = clamp((u - D * 0.6) / (D * 0.4 - 420));
        const sweep =
          Math.sin(wipeU * Math.PI * 2 * 2 - Math.PI / 2) * 0.5 + 0.5;
        if (wiping > 0)
          paw = [paw[0] + -7 * sweep * wiping, paw[1] + 18 * sweep * wiping];
        ex.paws.near = { at: paw, weight: raised * env };
        add('pitch', 0.42 * licking + 0.1 * wiping);
        head(
          1 * licking,
          (-2.2 - stroke * 1.6) * licking + 1.5 * wiping * sweep,
        );
        add('tongue', licking * Math.max(0, Math.sin(phase)) ** 3);
        shut(0.62 * licking + 0.9 * wiping);
        add('roll', f * 0.2 * wiping * sweep);
        add('yaw', f * 0.22 * (licking + wiping));
        ex.ears[nearEar] -= 0.7 * wiping * sweep * env;
        ears(-0.1 * licking, -0.1 * licking);
        break;
      }
      case 'yawn': {
        const m =
          ramp(u, 340, 950) * (1 - ramp(u, 1650 * act.tempo, 2150 * act.tempo));
        const dip = bump(u, 380);
        add('pitch', 0.12 * dip - 0.42 * m);
        head(-0.8 * m, 2.6 * m - 0.8 * dip);
        shut(ramp(u, 120, 460) * (1 - ramp(u, 2000, 2350)));
        add('happy', 0.5 * m);
        ears(-0.35 * m, -0.35 * m);
        swivel(0.3 * m, 0.3 * m);
        add('mouth', m);
        add('shiver', 0.5 * m);
        add('tongue', bump(u - 2150, 380));
        if (u > 2380 && !act.cued) ex.blink = act.cued = true;
        break;
      }
      case 'look': {
        let glance: Vec | null = null;
        for (const g of act.glances) if (u >= g.at) glance = g.to;
        if (env > 0.5) ex.glance = glance;
        if (glance) {
          const side = glance[0] < 0 ? 0 : 1;
          const up = glance[1] < -120 * input.scale;
          ex.ears[side] += 0.45 * env;
          ex.swivel[1 - side] += 0.35 * env;
          if (up) add('pupil', 0.25);
        }
        break;
      }
      case 'tilt': {
        const s = act.side;
        // Overshoots into the tilt and settles: curiosity has a bounce to it.
        const into = ramp(u, 0, 340);
        const back = Math.sin(into * Math.PI * 0.62) / Math.sin(Math.PI * 0.62);
        const amount = back * (1 - ramp(u, D - 380, D));
        add('roll', s * 0.27 * amount);
        head(s * -1.2 * amount, 0.6 * amount);
        ears(
          s < 0 ? 0.55 * amount : -0.15 * amount,
          s > 0 ? 0.55 * amount : -0.15 * amount,
        );
        swivel(s > 0 ? 0.5 * amount : 0, s < 0 ? 0.5 * amount : 0);
        add('pupil', 0.35 * amount);
        add('wide', 0.3 * amount);
        break;
      }
      case 'shake': {
        const w = clamp(u / D);
        const decay = (1 - w) ** 1.4;
        const hz = 7.5 * act.tempo;
        const osc = Math.sin((u / 1000) * hz * Math.PI * 2);
        const lag = Math.sin((u / 1000) * hz * Math.PI * 2 - 0.9);
        add('roll', 0.3 * osc * decay);
        head(1.4 * osc * decay, 0);
        ears(-0.2 + 0.7 * lag * decay, -0.2 - 0.7 * lag * decay);
        shut(0.85 * hold(u, 0, D, 90));
        add('shiver', decay);
        break;
      }
      case 'shuffle': {
        const lift = bump(u, D);
        const which = act.side > 0 ? 'near' : 'far';
        ex.paws[which] = {
          at: [
            fx + (which === 'far' ? -3 : 0) + 2.5 * act.side * lift,
            5.2 + 6 * lift,
          ],
          weight: env,
        };
        head(0.8 * act.side * lift, -0.6 * lift);
        add('roll', -0.04 * act.side * lift);
        add('pitch', 0.12 * lift);
        break;
      }
      case 'knead': {
        const hz = 1.35 * act.tempo;
        const phase = (u / 1000) * hz * Math.PI * 2;
        const press = (s: number) => Math.max(0, Math.sin(phase + s * Math.PI));
        ex.paws.near = {
          at: [fx + 3 * press(0), 5.2 + 7.5 * press(0)],
          weight: env,
        };
        ex.paws.far = {
          at: [fx - 3 + 3 * press(1), 5.2 + 7.5 * press(1)],
          weight: env,
        };
        const pushes = Math.abs(Math.sin(phase));
        head(0, -0.9 * pushes);
        add('pitch', 0.1 + 0.05 * pushes);
        add('happy', 1);
        add('smile', 0.6);
        add('blush', 0.5);
        add('shiver', 0.5);
        swivel(0.2, 0.2);
        break;
      }
      case 'meow': {
        const m = ramp(u, 60, 200) * (1 - ramp(u, D * 0.55, D * 0.9));
        add('mouth', 0.55 * m);
        add('pitch', -0.18 * m);
        head(0, 1.2 * m);
        add('wide', 0.35 * m);
        add('smile', 0.25 * m);
        ears(0.3 * m, 0.3 * m);
        break;
      }
      case 'sneeze': {
        const build = ramp(u, 0, 680) * (1 - ramp(u, 700, 760));
        const snap = bump(u - 700, 220);
        const after = hold(u, 760, D, 200);
        add('pitch', -0.3 * build + 0.65 * snap);
        head(4 * snap, 1.4 * build - 4.5 * snap);
        shut(
          Math.max(
            ramp(u, 200, 680) * (1 - ramp(u, 760, 980)),
            snap,
            0.4 * after,
          ),
        );
        add('happy', 0.45 * build + 0.6 * snap);
        add('mouth', 0.28 * build + 0.12 * snap);
        ears(-0.3 * build - 0.5 * snap, -0.3 * build - 0.5 * snap);
        add('shiver', snap);
        if (u > 1300 && !act.cued) ex.blink = act.cued = true;
        break;
      }
      case 'stretch': {
        // The play bow, with a yawn at the deepest point of it.
        const bow = hold(u, 120, D * 0.72, 500);
        if (bow > 0.35 && env > 0.5) ex.rest = 'stretch';
        const y = u - D * 0.22;
        const m = ramp(y, 300, 800) * (1 - ramp(y, 1350, 1800));
        add('mouth', 0.85 * m);
        add('pitch', -0.3 * m);
        shut(
          Math.max(0.55 * bow, ramp(y, 120, 400) * (1 - ramp(y, 1700, 2000))),
        );
        add('happy', 0.45 * m);
        ears(-0.3 * bow, -0.3 * bow);
        add('shiver', 0.4 * m);
        break;
      }
      case 'dream': {
        const w = bump(u, D);
        if (act.side > 0) {
          // An ear flicks at something in the dream.
          if (!act.cued) {
            act.cued = true;
            this.ears[act.tempo > 1 ? 0 : 1]!.v -= 16;
          }
          add('shiver', 0.4 * w);
        } else if (act.tempo > 1) {
          add('tongue', 0.7 * w);
        } else {
          add('shiver', w);
          ex.ears[0] -= 0.15 * w * env;
          ex.ears[1] -= 0.15 * w * env;
        }
        break;
      }
    }
  }
}
