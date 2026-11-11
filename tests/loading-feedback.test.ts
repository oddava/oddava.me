// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginLoading,
  beginNavigationFeedback,
  isPageNavigation,
  LOADING_MIN_VISIBLE,
  LOADING_REVEAL_DELAY,
  resetLoadingFeedback,
  stopNavigationFeedback,
} from '../src/lib/loading-feedback';

afterEach(() => {
  stopNavigationFeedback();
  resetLoadingFeedback();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('loading feedback', () => {
  it('does not flash for fast requests', () => {
    vi.useFakeTimers();
    const finish = beginLoading();
    vi.advanceTimersByTime(100);
    finish();
    vi.runAllTimers();
    expect(document.documentElement.hasAttribute('data-loading')).toBe(false);
  });

  it('stays visible until all overlapping requests finish', () => {
    vi.useFakeTimers();
    const first = beginLoading();
    const second = beginLoading();
    vi.advanceTimersByTime(LOADING_REVEAL_DELAY + 10);
    first();
    first();
    expect(document.documentElement.dataset.loading).toBe('true');
    vi.advanceTimersByTime(LOADING_MIN_VISIBLE);
    expect(document.documentElement.dataset.loading).toBe('true');
    second();
    expect(document.documentElement.hasAttribute('data-loading')).toBe(false);
  });

  it('holds a revealed loader for its minimum, then lets go', () => {
    vi.useFakeTimers();
    const finish = beginLoading();
    vi.advanceTimersByTime(LOADING_REVEAL_DELAY + 1);
    expect(document.documentElement.dataset.loading).toBe('true');
    finish();
    vi.advanceTimersByTime(LOADING_MIN_VISIBLE - 50);
    expect(document.documentElement.dataset.loading).toBe('true');
    vi.advanceTimersByTime(60);
    expect(document.documentElement.hasAttribute('data-loading')).toBe(false);
  });

  it('clears abandoned navigation without clearing an active search', () => {
    vi.useFakeTimers();
    const finishSearch = beginLoading();
    beginNavigationFeedback();
    vi.advanceTimersByTime(15_000);
    expect(document.documentElement.dataset.loading).toBe('true');
    finishSearch();
    expect(document.documentElement.hasAttribute('data-loading')).toBe(false);
  });

  it('ignores fragments and external protocols, but includes query changes', () => {
    const current = 'https://oddava.me/notes';
    expect(isPageNavigation('#heading', current)).toBe(false);
    expect(isPageNavigation('/notes', current)).toBe(false);
    expect(isPageNavigation('https://example.com/notes', current)).toBe(false);
    expect(isPageNavigation('mailto:me@example.com', current)).toBe(false);
    expect(isPageNavigation('/notes?q=hello', current)).toBe(true);
    expect(isPageNavigation('/notes/hello', current)).toBe(true);
  });
});
