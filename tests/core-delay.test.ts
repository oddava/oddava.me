import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay } from '../src/lib/server/core/delay';

describe('delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the delay elapses', async () => {
    let settled = false;
    const waiting = delay(100).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(settled).toBe(true);
  });

  it('rejects immediately with the reason of an already-aborted signal', async () => {
    const reason = new Error('gone');
    await expect(delay(100, AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it('stops waiting as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('client disconnected');
    const waiting = delay(10_000, controller.signal);

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});
