// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFolio } from '../src/lib/folio/mount';

let destroy: (() => void) | null = null;
let root: HTMLElement;
let reduced: MediaQueryList;
let forced: MediaQueryList;
let raf: ReturnType<typeof vi.fn>;
let trace: SVGPathElement;
let pending: FrameRequestCallback | undefined;
let now: number;

beforeEach(() => {
  document.body.innerHTML = `<div data-folio><svg>
    ${Array.from({ length: 6 }, () => '<g data-folio-accent></g>').join('')}
    <g data-folio-star></g><g data-folio-star></g>
    <path data-folio-island></path><path data-folio-island data-folio-trace></path>
  </svg></div><a href='/notes'>notes</a>`;
  root = document.querySelector('[data-folio]')!;
  reduced = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  forced = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('reduced-motion') ? reduced : forced,
  );
  now = 1000;
  pending = undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  raf = vi.fn((callback: FrameRequestCallback) => {
    pending = callback;
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn(() => {
      pending = undefined;
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1440,
    height: 1000,
    left: 0,
    top: 0,
  } as DOMRect);
  trace = root.querySelector('[data-folio-trace]')!;
  Object.assign(trace, {
    getTotalLength: vi.fn(() => 1000),
    getPointAtLength: vi.fn((distance: number) => ({
      x: 720 + 300 * Math.cos((distance / 1000) * Math.PI * 2),
      y: 500 + 200 * Math.sin((distance / 1000) * Math.PI * 2),
    })),
  });
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function move(x = 243, y = 517, target: EventTarget = document) {
  target.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }),
  );
}
function tick() {
  const callback = pending;
  pending = undefined;
  now += 1000 / 60;
  callback?.(now);
}
function settle() {
  for (let i = 0; i < 360 && pending; i++) tick();
}

describe('folio composition lifecycle', () => {
  it('measures the settled navigation layout after fonts load and keeps it on history return', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<h1 class="home-hero__name">name</h1><nav data-folio-nav><a href="/notes">notes</a></nav>',
    );
    const nav = document.querySelector<HTMLElement>('[data-folio-nav]')!;
    const title = document.querySelector<HTMLElement>('h1')!;
    const measured = vi
      .spyOn(title, 'getBoundingClientRect')
      .mockImplementation(() => {
        expect(nav.hasAttribute('data-ready')).toBe(true);
        return { left: 600, right: 800, top: 400, bottom: 450 } as DOMRect;
      });
    let ready!: () => void;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loading',
        ready: new Promise<void>((resolve) => {
          ready = resolve;
        }),
      },
    });
    destroy = mountFolio(root);
    expect(measured).not.toHaveBeenCalled();
    expect(root.hasAttribute('data-ready')).toBe(false);
    ready();
    await Promise.resolve();
    expect(measured).toHaveBeenCalledTimes(1);
    const path = root.querySelector('[data-folio-island]')!.getAttribute('d');
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    );
    expect(root.querySelector('[data-folio-island]')!.getAttribute('d')).toBe(
      path,
    );
    expect(root.hasAttribute('data-ready')).toBe(true);
  });

  it('has no idle loop, coalesces pointer input, and never deforms the island', () => {
    destroy = mountFolio(root);
    expect(root.dataset.ready).toBe('');
    expect(raf).not.toHaveBeenCalled();
    const island = root.querySelector('[data-folio-island]')!;
    const path = island.getAttribute('d');
    const measurements = vi.mocked(trace.getPointAtLength).mock.calls.length;
    for (let i = 0; i < 100; i++) move();
    expect(raf).toHaveBeenCalledTimes(1);
    settle();
    const accents = root.querySelectorAll<SVGGElement>('[data-folio-accent]');
    expect(
      Number(accents[0]!.style.getPropertyValue('--open')),
    ).toBeGreaterThan(0.7);
    expect(accents[1]!.style.getPropertyValue('--open')).toBe('0.000');
    expect(island.getAttribute('d')).toBe(path);
    expect(trace.getPointAtLength).toHaveBeenCalledTimes(measurements);
    expect(pending).toBeUndefined();
  });

  it('clears hover over links and on leave without intercepting clicks', () => {
    destroy = mountFolio(root);
    move();
    tick();
    move(100, 100, document.querySelector('a')!);
    settle();
    expect(
      root.querySelector<SVGGElement>('g')!.style.getPropertyValue('--open'),
    ).toBe('0.000');
    expect(Number(trace.style.opacity)).toBeLessThan(0.002);
    move();
    tick();
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    settle();
    expect(
      root.querySelector<SVGGElement>('g')!.style.getPropertyValue('--open'),
    ).toBe('0.000');
  });

  it('nudges nearby dust gently, settles, and leaves no idle animation loop', () => {
    destroy = mountFolio(root);
    const star = root.querySelector<SVGGElement>('[data-folio-star]')!;
    expect(raf).not.toHaveBeenCalled();
    move(100, 160);
    settle();
    const shift = Number.parseFloat(star.style.getPropertyValue('--dust-x'));
    expect(shift).toBeGreaterThan(0.1);
    expect(shift).toBeLessThan(2);
    expect(pending).toBeUndefined();
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    settle();
    expect(
      Math.abs(Number.parseFloat(star.style.getPropertyValue('--dust-x'))),
    ).toBeLessThan(0.01);
    expect(pending).toBeUndefined();
    Object.assign(reduced, { matches: true });
    reduced.dispatchEvent(new Event('change'));
    expect(star.getAttribute('style')).toBeNull();
  });

  it('uses bounded native touch bursts on mobile without spring frames or edge measurements', () => {
    vi.mocked(SVGElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 390,
      height: 844,
      left: 0,
      top: 0,
    } as DOMRect);
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    root.querySelectorAll('[data-folio-accent]').forEach((accent) => {
      const response = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'g',
      );
      response.setAttribute('class', 'folio-accent__response');
      Object.assign(response, { animate });
      accent.append(response);
    });
    destroy = mountFolio(root);
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 300,
      clientY: 80,
    });
    Object.assign(event, { pointerType: 'touch' });
    document.dispatchEvent(event);
    for (let i = 0; i < 100; i++) move(300, 80);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]).toEqual([
      expect.any(Array),
      { duration: 650, easing: 'ease-out' },
    ]);
    expect(raf).not.toHaveBeenCalled();
    expect(trace.getTotalLength).not.toHaveBeenCalled();
    expect(trace.getPointAtLength).not.toHaveBeenCalled();
    Object.assign(reduced, { matches: true });
    reduced.dispatchEvent(new Event('change'));
    expect(cancel).toHaveBeenCalled();
    move(300, 80);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('honors reduced motion and forced colors, including preference changes', () => {
    Object.assign(reduced, { matches: true });
    destroy = mountFolio(root);
    move();
    expect(raf).not.toHaveBeenCalled();
    Object.assign(reduced, { matches: false });
    reduced.dispatchEvent(new Event('change'));
    move();
    tick();
    Object.assign(forced, { matches: true });
    forced.dispatchEvent(new Event('change'));
    expect(trace.style.opacity).toBe('0');
    raf.mockClear();
    move();
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels pending work when hidden or disposed and remounts without duplicate listeners', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    destroy = mountFolio(root);
    destroy = mountFolio(root);
    move();
    expect(raf).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    raf.mockClear();
    move();
    expect(raf).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    move();
    expect(raf).toHaveBeenCalledTimes(1);
    destroy?.();
    destroy = null;
    raf.mockClear();
    move();
    expect(raf).not.toHaveBeenCalled();
  });
});
