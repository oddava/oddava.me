// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { restoreNoteExplorerState } from '../src/lib/note-explorer-state';

beforeEach(() => localStorage.clear());

function page(open = false) {
  const details = document.createElement('details');
  details.open = open;
  restoreNoteExplorerState(details);
  return details;
}

it('keeps first-visit defaults, then remembers both open and closed choices across pages', () => {
  const root = page(true);
  root.dispatchEvent(new Event('toggle'));
  expect(page().open).toBe(false);

  const first = page();
  first.open = true;
  first.dispatchEvent(new Event('toggle'));
  const second = page();
  expect(second.open).toBe(true);
  second.open = false;
  second.dispatchEvent(new Event('toggle'));
  expect(page(true).open).toBe(false);
});

it('leaves the disclosure usable when storage is blocked', () => {
  const storage = vi
    .spyOn(window, 'localStorage', 'get')
    .mockImplementation(() => {
      throw new Error('Storage disabled');
    });
  try {
    const details = page();
    expect(details.open).toBe(false);
    details.open = true;
    expect(() => details.dispatchEvent(new Event('toggle'))).not.toThrow();
    expect(details.open).toBe(true);
  } finally {
    storage.mockRestore();
  }
});
