import type { VisitorPulse } from '../../lib/contracts';
import { isRecord } from '../../lib/records';

/**
 * The page's side of the visitor pulse: one heartbeat per page, shared by
 * every view that shows the counts (the footer, the sky). It pulses on load,
 * every PULSE_EVERY_MS while the tab is visible, and at once when a hidden
 * tab comes back — a tab in the background is not "here".
 *
 * Kept on globalThis rather than in module scope, so a page whose scripts
 * end up in two bundles still sends one pulse, not two.
 */

/** Matches PULSE_INTERVAL_MS on the server, inside its 60s window. */
const PULSE_EVERY_MS = 25_000;
/**
 * How long a count stays true without a fresh pulse: the server's presence
 * window. Past it, the count is withdrawn rather than left breathing.
 */
const STALE_AFTER_MS = 60_000;
/** A pulse that has not answered by now is abandoned, not waited on. */
const REQUEST_TIMEOUT_MS = 10_000;
/** A tab that comes back within this of its last pulse waits its turn. */
const MIN_GAP_MS = 8_000;
const MAX_BACKOFF_MS = 120_000;

/** A pulse, or null when the last one has gone stale. */
type Listener = (pulse: VisitorPulse | null) => void;

interface PulseState {
  listeners: Set<Listener>;
  last: VisitorPulse | null;
  lastAt: number;
  timer: number;
  staleTimer: number;
  inFlight: boolean;
  failures: number;
  /** Set when the server says the feature is off; nothing more is sent. */
  stopped: boolean;
  started: boolean;
}

const KEY = '__oddavaVisitorPulse';

function state(): PulseState {
  const host = globalThis as unknown as Record<string, PulseState | undefined>;
  host[KEY] ??= {
    listeners: new Set(),
    last: null,
    lastAt: 0,
    timer: 0,
    staleTimer: 0,
    inFlight: false,
    failures: 0,
    stopped: false,
    started: false,
  };
  return host[KEY];
}

export function parsePulse(value: unknown): VisitorPulse | null {
  if (!isRecord(value)) return null;
  const { here, visitors, today } = value;
  const valid = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!valid(here) || !valid(visitors) || !valid(today)) return null;
  return { here, visitors, today };
}

function schedule(s: PulseState, ms: number) {
  clearTimeout(s.timer);
  if (s.stopped) return;
  s.timer = window.setTimeout(() => void beat(s), ms);
}

/** Withdraws the counts once the last good pulse is older than the window. */
function expireLater(s: PulseState) {
  clearTimeout(s.staleTimer);
  s.staleTimer = window.setTimeout(() => {
    if (!s.last || Date.now() - s.lastAt < STALE_AFTER_MS) return;
    s.last = null;
    for (const listener of s.listeners) listener(null);
  }, STALE_AFTER_MS);
}

const VISITOR_KEY = 'pulse:visitor';

/**
 * This browser's anonymous visitor id: random, kept in this browser only,
 * never tied to anything else. It lets two people behind one address count
 * as two. Without storage it lives as long as the page.
 */
function visitorId(): string {
  const host = globalThis as unknown as { __oddavaVisitorId?: string };
  if (host.__oddavaVisitorId) return host.__oddavaVisitorId;
  let id: string | null = null;
  try {
    id = localStorage.getItem(VISITOR_KEY);
  } catch {
    // Storage blocked: a per-page id below.
  }
  if (!id || !/^[0-9a-f-]{16,64}$/.test(id)) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(VISITOR_KEY, id);
    } catch {
      // Private mode: the id lasts this page.
    }
  }
  host.__oddavaVisitorId = id;
  return id;
}

async function beat(s: PulseState) {
  if (s.stopped || s.inFlight) return;
  if (document.visibilityState !== 'visible') return;
  s.inFlight = true;
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/pulse', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ visitor: visitorId() }),
      signal: abort.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    // Cross-origin, or a deployment without storage or signing: neither gets
    // better by asking again from this page. A Redis blip (pulse_unavailable)
    // backs off and retries instead.
    const code = isRecord(body) ? body.code : undefined;
    if (
      response.status === 403 ||
      code === 'storage_unavailable' ||
      code === 'signing_unavailable'
    ) {
      s.stopped = true;
      if (s.last) {
        s.last = null;
        for (const listener of s.listeners) listener(null);
      }
      return;
    }
    const pulse = parsePulse(body);
    if (!response.ok || !pulse) throw new Error('bad pulse');
    s.failures = 0;
    s.last = pulse;
    s.lastAt = Date.now();
    for (const listener of s.listeners) listener(pulse);
    expireLater(s);
    schedule(s, PULSE_EVERY_MS);
  } catch {
    s.failures += 1;
    schedule(
      s,
      Math.min(MAX_BACKOFF_MS, PULSE_EVERY_MS * 2 ** (s.failures - 1)),
    );
  } finally {
    clearTimeout(timeout);
    s.inFlight = false;
  }
}

function start(s: PulseState) {
  if (s.started) return;
  s.started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      clearTimeout(s.timer);
      return;
    }
    const since = Date.now() - s.lastAt;
    schedule(s, since >= MIN_GAP_MS ? 0 : MIN_GAP_MS - since);
  });
  void beat(s);
}

/**
 * Calls `listener` with every pulse (and at once with the last one, if
 * there is one), and with null when the counts go stale. The first
 * subscriber starts the heartbeat.
 */
export function onPulse(listener: Listener): () => void {
  const s = state();
  s.listeners.add(listener);
  if (s.last) listener(s.last);
  start(s);
  return () => {
    s.listeners.delete(listener);
  };
}

const NUMBER = new Intl.NumberFormat('en');

export function formatCount(value: number): string {
  return NUMBER.format(value);
}

/** "just you here", "2 here now". */
export function hereLabel(here: number): string {
  return here <= 1 ? 'just you here' : `${formatCount(here)} here now`;
}

/** "1 visitor", "1,204 visitors". */
export function visitorsLabel(visitors: number): string {
  return `${formatCount(visitors)} ${visitors === 1 ? 'visitor' : 'visitors'}`;
}

/** The sentence a screen reader hears. */
export function pulseSentence({ here, visitors, today }: VisitorPulse): string {
  const people =
    here <= 1
      ? 'You are the only one here right now'
      : `${formatCount(here)} people are here right now`;
  return `${people}. ${visitorsLabel(visitors)} so far, ${formatCount(today)} today.`;
}
