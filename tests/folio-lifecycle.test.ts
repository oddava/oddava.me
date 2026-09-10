// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolioSheet } from '../src/lib/folio/physics';
import { mountFolio } from '../src/lib/folio/mount';

let destroy: (() => void) | null = null;
let root: HTMLElement;
let reduced: MediaQueryList;
let raf: ReturnType<typeof vi.fn>;
let clear: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = `<div data-folio><canvas></canvas>
    </div>`;
  root = document.querySelector('[data-folio]')!;
  reduced = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  const forced = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('reduced-motion') ? reduced : forced,
  );
  raf = vi.fn(() => 1);
  clear = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect',
  ).mockReturnValue({ width: 1440, height: 900 } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: clear,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    setTransform() {},
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('folio lifecycle and accessible controls', () => {
  it('renders a still sheet with reduced motion until explicitly resumed', () => {
    Object.defineProperty(reduced, 'matches', { value: true });
    destroy = mountFolio(root);
    expect(root.dataset.ready).toBe('');
    expect(raf).not.toHaveBeenCalled();

    expect(root.dataset.motion).toBe('still');
  });

  it('ignores obsolete stored pause preferences when there is no pause control', () => {
    sessionStorage.setItem('oddava:folio:paused', 'true');
    destroy = mountFolio(root);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('continues ambient motion without touch and freezes it when paused', () => {
    const reshape = vi.spyOn(FolioSheet.prototype, 'reshape');
    destroy = mountFolio(root);
    reshape.mockClear();
    const tick = raf.mock.calls.at(-1)![0] as FrameRequestCallback;
    tick(performance.now() + 40);
    expect(reshape).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      false,
      expect.any(Number),
    );
    expect(reshape.mock.calls[0]![3]).toBeGreaterThan(0);
    expect(raf).toHaveBeenCalledTimes(2);
    Object.defineProperty(reduced, 'matches', { value: true });
    reduced.dispatchEvent(new Event('change'));
    expect(root.dataset.motion).toBe('still');
    reshape.mockClear();
    tick(performance.now() + 80);
    expect(reshape).not.toHaveBeenCalled();
  });

  it('stops when hidden and resumes only one loop when visible', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(false);
    destroy = mountFolio(root);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    clear.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(clear).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('plucks at each touch location without changing the whole composition on release', () => {
    const pluck = vi.spyOn(FolioSheet.prototype, 'pluck');
    destroy = mountFolio(root);
    const canvas = root.querySelector('canvas')!;
    for (const [pointerId, x, y] of [
      [1, 100, 200],
      [2, 1100, 600],
    ]) {
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
      });
      Object.assign(event, { pointerId, pressure: 0.7, pointerType: 'touch' });
      canvas.dispatchEvent(event);
    }
    expect(pluck).toHaveBeenCalledTimes(2);
    expect(pluck.mock.calls[0]![0]).toMatchObject({
      x: 100,
      y: 200,
      pressure: 0.7,
    });
    expect(pluck.mock.calls[1]![0]).toMatchObject({
      x: 1100,
      y: 600,
      pressure: 0.7,
    });
    canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(root.dataset.page).toBeUndefined();
    const link = document.createElement('a');
    document.body.append(link);
    link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(pluck).toHaveBeenCalledTimes(2);
  });

  it('removes listeners on disposal and leaves the fallback alone if canvas is unavailable', () => {
    destroy = mountFolio(root);
    destroy?.();
    destroy = null;
    expect(root.dataset.page).toBeUndefined();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(mountFolio(root)).toBeNull();
  });
});
