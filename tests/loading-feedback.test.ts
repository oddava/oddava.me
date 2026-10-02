// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awakenHomepage,
  beginLoading,
  beginNavigationFeedback,
  isPageNavigation,
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
    vi.advanceTimersByTime(150);
    first();
    first();
    expect(document.documentElement.dataset.loading).toBe('true');
    second();
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

describe('homepage awakening', () => {
  function setup(type = 'navigate') {
    vi.useFakeTimers();
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type }] });
    document.body.innerHTML =
      '<div data-site-loader></div><div data-folio></div>';
    return {
      loader: document.querySelector<HTMLElement>('[data-site-loader]')!,
      folio: document.querySelector<HTMLElement>('[data-folio]')!,
    };
  }

  it('skips fast loads and reveals a slow load only until geometry is ready', async () => {
    let { loader, folio } = setup();
    awakenHomepage();
    folio.dataset.ready = '';
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(loader.hasAttribute('data-intro')).toBe(false);

    ({ loader, folio } = setup());
    awakenHomepage();
    vi.advanceTimersByTime(200);
    expect(loader.hasAttribute('data-awakening')).toBe(true);
    folio.dataset.ready = '';
    await Promise.resolve();
    expect(loader.hasAttribute('data-awakening')).toBe(false);
    vi.advanceTimersByTime(650);
    expect(loader.hasAttribute('data-intro')).toBe(false);
  });

  it('never replays on history return and clears before a bfcache snapshot', () => {
    let { loader } = setup('back_forward');
    awakenHomepage();
    vi.advanceTimersByTime(200);
    expect(loader.hasAttribute('data-intro')).toBe(false);
    ({ loader } = setup());
    awakenHomepage();
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('pagehide'));
    expect(loader.hasAttribute('data-intro')).toBe(false);
    expect(loader.hasAttribute('data-awakening')).toBe(false);
  });

  it('clears an in-progress reveal before history snapshots', async () => {
    const { loader, folio } = setup();
    awakenHomepage();
    vi.advanceTimersByTime(200);
    folio.dataset.ready = '';
    await Promise.resolve();
    expect(loader.hasAttribute('data-intro')).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(loader.hasAttribute('data-intro')).toBe(false);
    vi.runAllTimers();
  });

  it('fails open when the background never becomes ready', () => {
    const { loader } = setup();
    awakenHomepage();
    vi.advanceTimersByTime(8700);
    expect(loader.hasAttribute('data-intro')).toBe(false);
    expect(loader.hasAttribute('data-awakening')).toBe(false);
  });
});
