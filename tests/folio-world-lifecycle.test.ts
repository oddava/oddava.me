// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountWorld } from '../src/lib/folio/world';
import { createWorld } from '../src/lib/folio/world-physics';

const view = {
  width: 1440,
  height: 1000,
  centerX: 720,
  centerY: 500,
  quietWidth: 410,
  quietHeight: 220,
};
let root: HTMLElement;
let world: ReturnType<typeof mountWorld>;
let reduced: MediaQueryList;
let callbacks: Map<number, FrameRequestCallback>;
let now: number;

beforeEach(() => {
  document.body.innerHTML = '<div data-folio></div>';
  root = document.querySelector('[data-folio]')!;
  reduced = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  const forced = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('reduced-motion') ? reduced : forced,
  );
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  now = 1000;
  let id = 0;
  callbacks = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    callbacks.set(++id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
  world = mountWorld(root);
  world.resize(view);
});
afterEach(() => {
  world.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function move(x: number, y: number) {
  const event = new MouseEvent('pointermove', {
    clientX: x,
    clientY: y,
    bubbles: true,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  document.dispatchEvent(event);
}
function tick() {
  now += 1000 / 144;
  const pending = [...callbacks.values()];
  callbacks.clear();
  pending.forEach((fn) => fn(now));
}

it('keeps simulating at 144Hz, names Felis while lit, then sleeps after the pointer leaves', () => {
  const chest = createWorld(view).bodies[4]!;
  const star = root.querySelectorAll('[data-kind=star]')[4]!;
  const name = root.querySelector<SVGTextElement>('.folio-world__name')!;
  const start = star.getAttribute('transform');
  expect(name.textContent).toContain('felis');
  expect(Number(name.style.opacity)).toBe(0);
  move(chest.x - 30, chest.y);
  tick();
  expect(callbacks.size).toBe(1);
  for (let i = 0; i < 120; i++) tick();
  expect(star.getAttribute('transform')).not.toBe(start);
  expect(Number(name.style.opacity)).toBeGreaterThan(0.3);
  move(720, 500);
  for (let i = 0; i < 3600 && callbacks.size; i++) tick();
  expect(callbacks.size).toBe(0);
  expect(Number(name.style.opacity)).toBeLessThan(0.01);
});

it('stops while hidden or reduced, and removes its listeners and surface on destroy', () => {
  move(100, 330);
  expect(callbacks.size).toBe(1);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(callbacks.size).toBe(0);
  move(110, 330);
  expect(callbacks.size).toBe(0);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.assign(reduced, { matches: true });
  reduced.dispatchEvent(new Event('change'));
  move(110, 330);
  expect(callbacks.size).toBe(0);
  Object.assign(reduced, { matches: false });
  reduced.dispatchEvent(new Event('change'));
  move(110, 330);
  expect(callbacks.size).toBe(1);
  world.destroy();
  expect(callbacks.size).toBe(0);
  expect(root.children).toHaveLength(0);
  move(110, 330);
  expect(callbacks.size).toBe(0);
});

it('makes one idle gesture, then sleeps without rearming; resets cancel the timer', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  world.resize(view);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(30000);
  expect(callbacks.size).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  for (let i = 0; i < 8000 && callbacks.size; i++) tick();
  expect(callbacks.size).toBe(0);
  move(720, 500);
  expect(vi.getTimerCount()).toBe(1);
  Object.assign(reduced, { matches: true });
  reduced.dispatchEvent(new Event('change'));
  expect(vi.getTimerCount()).toBe(0);
  Object.assign(reduced, { matches: false });
  reduced.dispatchEvent(new Event('change'));
  expect(vi.getTimerCount()).toBe(1);
  world.destroy();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
