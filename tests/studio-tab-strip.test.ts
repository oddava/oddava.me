import { describe, expect, it } from 'vitest';
import { MAX_OPEN_TABS } from '../src/components/admin/studioSession';
import {
  EMPTY_STRIP,
  closeInStrip,
  normalizeStrip,
  openInStrip,
  renameInStrip,
  retainInStrip,
  type TabStrip,
} from '../src/components/admin/studioTabStrip';

const strip = (openIds: string[], previewId = ''): TabStrip => ({
  openIds,
  previewId,
});

describe('opening files in the tab strip', () => {
  it('reuses one tab while browsing instead of stacking them up', () => {
    let current = openInStrip(EMPTY_STRIP, 'alpha');
    current = openInStrip(current, 'beta');
    current = openInStrip(current, 'gamma');
    expect(current).toEqual(strip(['gamma'], 'gamma'));
  });

  it('replaces the preview tab in place, keeping the strip in order', () => {
    const current = openInStrip(strip(['alpha', 'beta', 'gamma'], 'beta'), 'x');
    expect(current).toEqual(strip(['alpha', 'x', 'gamma'], 'x'));
  });

  it('keeps deliberately opened tabs and adds one of its own', () => {
    let current = openInStrip(EMPTY_STRIP, 'alpha');
    current = openInStrip(current, 'beta', { placement: 'permanent' });
    expect(current).toEqual(strip(['alpha', 'beta'], 'alpha'));

    // Browsing on still reuses the preview slot, not the file kept on purpose.
    current = openInStrip(current, 'gamma');
    expect(current).toEqual(strip(['gamma', 'beta'], 'gamma'));
  });

  it('leaves an already open file exactly where it is', () => {
    const before = strip(['alpha', 'beta'], 'beta');
    expect(openInStrip(before, 'alpha')).toBe(before);
  });

  it('pins the preview tab when the same file is opened deliberately', () => {
    const current = openInStrip(strip(['alpha'], 'alpha'), 'alpha', {
      placement: 'permanent',
    });
    expect(current).toEqual(strip(['alpha'], ''));
  });

  it('drops a tab at the index it was dragged to', () => {
    const current = openInStrip(strip(['alpha', 'beta', 'gamma']), 'delta', {
      placement: 'permanent',
      index: 1,
    });
    expect(current.openIds).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });

  it('never reuses the tab the second editor is showing', () => {
    const current = openInStrip(strip(['alpha', 'beta'], 'beta'), 'gamma', {
      keepId: 'beta',
    });
    expect(current).toEqual(strip(['alpha', 'beta', 'gamma'], 'gamma'));
  });

  it('trims the oldest tabs rather than the one just opened', () => {
    const full = Array.from(
      { length: MAX_OPEN_TABS },
      (_, index) => `n${index}`,
    );
    const current = openInStrip(strip(full), 'fresh', {
      placement: 'permanent',
      index: 0,
    });
    expect(current.openIds).toHaveLength(MAX_OPEN_TABS);
    expect(current.openIds[0]).toBe('fresh');
    expect(current.openIds).not.toContain('n0');
  });
});

describe('closing and renaming', () => {
  it('frees the preview slot when that tab closes', () => {
    expect(closeInStrip(strip(['alpha', 'beta'], 'beta'), 'beta')).toEqual(
      strip(['alpha'], ''),
    );
  });

  it('keeps the preview tab when a different tab closes', () => {
    expect(closeInStrip(strip(['alpha', 'beta'], 'beta'), 'alpha')).toEqual(
      strip(['beta'], 'beta'),
    );
  });

  it('retains only the tabs asked for', () => {
    expect(retainInStrip(strip(['a', 'b', 'c'], 'c'), ['b'])).toEqual(
      strip(['b'], ''),
    );
    expect(retainInStrip(strip(['a', 'b'], 'a'), [])).toEqual(strip([], ''));
  });

  it('follows a rename through the strip and the preview slot', () => {
    expect(renameInStrip(strip(['a', 'b'], 'b'), 'b', 'c')).toEqual(
      strip(['a', 'c'], 'c'),
    );
  });

  it('forgets a preview tab a restored session no longer has', () => {
    expect(normalizeStrip(strip(['a'], 'gone'))).toEqual(strip(['a'], ''));
  });
});
