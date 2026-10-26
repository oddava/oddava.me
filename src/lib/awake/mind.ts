import {
  blinkClosure,
  bump,
  clamp,
  easeOutCubic,
  SLOW_BLINK_MS,
  slowBlinkClosure,
} from './spring';

/**
 * The cat's moods as a pure, clock-driven state machine. It never touches the
 * DOM: the mount loop feeds it time and a summary of the visitor's input, and
 * draws whatever it answers. All durations are milliseconds.
 */
export type Phase = 'awake' | 'drowsy' | 'asleep';

export type MindEvent =
  /** The cat slow-blinks at the visitor; a window to answer opens. */
  | 'offer'
  /** The visitor answered; the cat is about to blink back. */
  | 'exchange'
  /** The answered slow blink lands: purr, rings, the starry "prrr". */
  | 'purr'
  /** A plain pat on the head. */
  | 'pet'
  | 'swipe'
  | 'sleep'
  | 'wake';

export const TIMING = {
  /** Eyes begin to open this long after the page starts. */
  wakeIn: 480,
  wakeDone: 1260,
  /** Stillness before the cat offers its slow blink. */
  offerQuiet: 2000,
  /** After an unanswered offer, wait this long before offering again. */
  offerAgain: 4000,
  /** After a returned blink, the cat doesn't ask again for a while. */
  offerAfterExchange: 20000,
  /** How long, after its blink, the cat waits for an answer. */
  window: 7000,
  doubleTap: 380,
  /** The cat answers a beat after you do. */
  returnDelay: 240,
  purr: 3800,
  content: 12000,
  drowsy: 9000,
  asleep: 13500,
};

export interface MindInput {
  now: number;
  /** ms since the last pointer, touch, key or scroll input. */
  quietFor: number;
  /** 0..1 prey-likeness of recent pointer motion (see `dartScore`). */
  dart: number;
  /** Looking at something specific (a nav node, the moon) — no offers. */
  interested: boolean;
  /** The visitor has shown they're here (moved, touched, tabbed, or simply
   *  stayed a while); the cat doesn't slow-blink at an empty room. */
  engaged?: boolean;
}

export interface MindOutput {
  phase: Phase;
  /** Resting lid openness the eyes ease toward. */
  lid: number;
  /** Instantaneous blink closure, 0 open → 1 shut. Applied unsprung. */
  closure: number;
  smile: number;
  /** 0..1 crouched, wide-eyed hunting. */
  hunting: number;
  /** 0..1 how far the page dims for sleep. */
  dim: number;
  purring: boolean;
  /** The cat has slow-blinked and is waiting for an answer. */
  offering: boolean;
  events: MindEvent[];
}

export type PokeResult = 'wake' | 'exchange' | 'pet' | 'busy';

/** The opening choreography: shut, a sleepy peek, one blink, then wide open. */
export function wakeClosure(t: number) {
  const { wakeIn } = TIMING;
  if (t < wakeIn) return 1;
  const u = t - wakeIn;
  if (u < 260) return 1 - 0.45 * easeOutCubic(u / 260);
  if (u < 380) return 0.55;
  if (u < 470) return 0.55 + 0.45 * ((u - 380) / 90) ** 2;
  if (u < 780) return 1 - easeOutCubic((u - 470) / 310);
  return 0;
}

export class CatMind {
  phase: Phase = 'awake';
  offerAt = -Infinity;
  windowUntil = -Infinity;
  exchangeAt = -Infinity;
  private readonly born: number;
  private readonly rand: () => number;
  private nextBlink: number;
  private blinkAt = -Infinity;
  private blinkDouble = false;
  private lastOfferEnd = -Infinity;
  private petAt = -Infinity;
  private purrUntil = -Infinity;
  private purrFired = true;
  private contentUntil = -Infinity;
  private lastPoke = -Infinity;
  private huntTime = 0;
  private lastSwipe = -Infinity;
  private lastTick: number;
  private drowsyAt = -Infinity;
  private queued: MindEvent[] = [];

  constructor(now: number, rand: () => number = Math.random) {
    this.born = now;
    this.lastTick = now;
    this.rand = rand;
    this.nextBlink = now + TIMING.wakeDone + 2200 + rand() * 2500;
  }

  get awakeSince() {
    return this.born + TIMING.wakeDone;
  }

  /** Any visitor input. Wakes a drowsy or sleeping cat. */
  stir(now: number) {
    if (this.phase === 'awake') return false;
    this.phase = 'awake';
    this.queued.push('wake');
    // Surfacing from sleep: a quick double blink, then back to normal.
    this.blinkAt = now + 140;
    this.blinkDouble = true;
    this.nextBlink = now + 3500 + this.rand() * 3000;
    return true;
  }

  /** A click, tap or key press on the cat. */
  poke(now: number): PokeResult {
    if (this.stir(now)) return 'wake';
    if (now < this.exchangeAt + TIMING.returnDelay + SLOW_BLINK_MS)
      return 'busy';
    const windowOpen = now >= this.offerAt + 400 && now <= this.windowUntil;
    const double = now - this.lastPoke < TIMING.doubleTap;
    this.lastPoke = now;
    if (windowOpen || double) {
      this.exchangeAt = now;
      this.windowUntil = -Infinity;
      this.lastOfferEnd = now + TIMING.offerAfterExchange;
      this.purrFired = false;
      this.purrUntil = now + TIMING.returnDelay + 520 + TIMING.purr;
      this.contentUntil = now + TIMING.content;
      this.nextBlink = now + TIMING.returnDelay + SLOW_BLINK_MS + 3200;
      this.queued.push('exchange');
      return 'exchange';
    }
    this.petAt = now;
    this.purrUntil = Math.max(this.purrUntil, now + 1500);
    this.queued.push('pet');
    return 'pet';
  }

  tick({
    now,
    quietFor,
    dart,
    interested,
    engaged = true,
  }: MindInput): MindOutput {
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const events = this.queued;
    this.queued = [];
    const age = now - this.born;
    const waking = age < TIMING.wakeDone;

    // Hunting: prey-like motion builds up, calm motion bleeds it away fast.
    if (dart > 0.4 && this.phase === 'awake' && !waking)
      this.huntTime = Math.min(1400, this.huntTime + dt);
    else this.huntTime = Math.max(0, this.huntTime - dt * 3);
    const hunting = clamp(this.huntTime / 300);
    if (this.huntTime > 750 && now - this.lastSwipe > 1500) {
      this.lastSwipe = now;
      events.push('swipe');
    }

    const offering = now >= this.offerAt && now <= this.windowUntil;
    const exchanging =
      now < this.exchangeAt + TIMING.returnDelay + SLOW_BLINK_MS;
    const purring = now < this.purrUntil;

    // Sleep follows long stillness, but never interrupts a conversation.
    if (
      this.phase === 'awake' &&
      quietFor >= TIMING.drowsy &&
      !offering &&
      !purring &&
      hunting === 0
    ) {
      this.phase = 'drowsy';
      this.drowsyAt = now;
    }
    if (this.phase === 'drowsy' && quietFor >= TIMING.asleep) {
      this.phase = 'asleep';
      events.push('sleep');
    }

    // The slow blink offer: stillness, nothing else on its mind.
    if (
      this.phase === 'awake' &&
      !waking &&
      !offering &&
      !exchanging &&
      !purring &&
      !interested &&
      engaged &&
      hunting === 0 &&
      quietFor >= TIMING.offerQuiet &&
      now >= this.awakeSince + 400 &&
      now >= this.lastOfferEnd
    ) {
      this.offerAt = now;
      this.windowUntil = now + SLOW_BLINK_MS + TIMING.window;
      this.lastOfferEnd = this.windowUntil + TIMING.offerAgain;
      this.nextBlink = now + SLOW_BLINK_MS + 2600 + this.rand() * 2000;
      events.push('offer');
    }

    if (!this.purrFired && now >= this.exchangeAt + TIMING.returnDelay + 520) {
      this.purrFired = true;
      events.push('purr');
    }

    // Ordinary blinks, every 3–7 s, sometimes doubled.
    const busy =
      waking ||
      now < this.offerAt + SLOW_BLINK_MS ||
      exchanging ||
      this.phase === 'asleep';
    if (now >= this.nextBlink) {
      if (!busy) {
        this.blinkAt = now;
        this.blinkDouble = this.rand() < 0.2;
      }
      this.nextBlink = now + 3000 + this.rand() * 4000;
    }

    let closure = waking ? wakeClosure(age) : 0;
    closure = Math.max(closure, blinkClosure(now - this.blinkAt));
    if (this.blinkDouble)
      closure = Math.max(closure, blinkClosure(now - this.blinkAt - 300));
    closure = Math.max(closure, slowBlinkClosure(now - this.offerAt));
    closure = Math.max(
      closure,
      slowBlinkClosure(now - this.exchangeAt - TIMING.returnDelay),
    );
    closure = Math.max(closure, 0.5 * bump(now - this.petAt, 950));

    let lid = 1;
    const content =
      now < this.contentUntil ||
      (now >= this.offerAt + SLOW_BLINK_MS * 0.6 && now <= this.windowUntil);
    if (content) lid = 0.74;
    if (this.phase === 'drowsy') {
      const sink = clamp((quietFor - TIMING.drowsy) / 3800);
      lid = Math.min(lid, 1 - 0.72 * sink);
      // Heavy, failing blinks while dozing off.
      const t = (now - this.drowsyAt) % 2300;
      closure = Math.max(closure, 0.85 * bump(t - 900, 1200));
    }
    if (this.phase === 'asleep') lid = 0;

    let smile = content ? 0.35 : 0;
    if (purring) smile = Math.max(smile, 0.5);
    smile = Math.max(smile, 0.65 * bump(now - this.petAt, 1100));
    if (this.phase === 'asleep') smile = 0.45;

    return {
      phase: this.phase,
      lid,
      closure: clamp(closure),
      smile,
      hunting,
      dim: this.phase === 'asleep' ? 1 : 0,
      purring,
      offering: now >= this.offerAt + 1150 && now <= this.windowUntil,
      events,
    };
  }
}
