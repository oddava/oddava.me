import { describe, expect, it } from 'vitest';
import { decidePublicNote } from '../src/lib/garden/retired';
import {
  followNoteRedirect,
  retargetRedirects,
} from '../src/lib/server/content/note-archive';

const goodbye = {
  path: 'reading/goodbye',
  sourceId: 'reading/goodbye',
  href: '/notes/reading/goodbye',
};
const nestedHello = {
  path: 'diary/hello',
  sourceId: 'diary/hello',
  href: '/notes/diary/hello',
};

describe('note redirects', () => {
  it('points every older path at the note a chain of renames ends on', () => {
    const once = retargetRedirects(new Map(), 'diary/hello', 'reading/hello');
    const twice = retargetRedirects(once, 'reading/hello', 'reading/goodbye');
    expect([...twice.entries()].toSorted()).toEqual([
      ['diary/hello', 'reading/goodbye'],
      ['reading/hello', 'reading/goodbye'],
    ]);

    const back = retargetRedirects(twice, 'reading/goodbye', 'diary/hello');
    expect(back.get('reading/hello')).toBe('diary/hello');
    expect(back.get('reading/goodbye')).toBe('diary/hello');
    expect(back.has('diary/hello')).toBe(false);

    expect(followNoteRedirect('diary/hello', twice)).toMatchObject({
      path: 'reading/goodbye',
      hopped: true,
      cycle: false,
    });
    expect(followNoteRedirect('reading/hello', twice).path).toBe(
      'reading/goodbye',
    );
  });

  it('follows a chain that was stored as hops and stops on a cycle', () => {
    const hops = new Map([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(followNoteRedirect('a', hops)).toMatchObject({
      path: 'c',
      hopped: true,
      cycle: false,
    });

    const cycle = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(followNoteRedirect('a', cycle).cycle).toBe(true);
  });

  it('sends a public URL to the current note, or says the note is gone', () => {
    const redirects = new Map([
      ['diary/hello', 'reading/goodbye'],
      ['reading/hello', 'reading/goodbye'],
    ]);
    expect(
      decidePublicNote('diary/hello', [goodbye], {
        redirects,
        tombstones: new Set(),
      }),
    ).toEqual({ kind: 'redirect', href: '/notes/reading/goodbye' });
    expect(
      decidePublicNote('reading/hello', [goodbye], {
        redirects,
        tombstones: new Set(),
      }),
    ).toEqual({ kind: 'redirect', href: '/notes/reading/goodbye' });

    const hops = new Map([
      ['diary/hello', 'reading/hello'],
      ['reading/hello', 'reading/goodbye'],
    ]);
    expect(
      decidePublicNote('diary/hello', [goodbye], {
        redirects: hops,
        tombstones: new Set(),
      }),
    ).toEqual({ kind: 'redirect', href: '/notes/reading/goodbye' });

    expect(
      decidePublicNote('diary/hello', [], {
        redirects,
        tombstones: new Set(['reading/goodbye']),
      }).kind,
    ).toBe('gone');
    expect(
      decidePublicNote('reading/goodbye', [], {
        redirects,
        tombstones: new Set(['reading/goodbye']),
      }).kind,
    ).toBe('gone');
  });

  it('does not let a bare file name replace a removed note', () => {
    expect(
      decidePublicNote('hello', [nestedHello], {
        redirects: new Map(),
        tombstones: new Set(),
      }),
    ).toEqual({ kind: 'redirect', href: '/notes/diary/hello' });

    expect(
      decidePublicNote('hello', [nestedHello], {
        redirects: new Map(),
        tombstones: new Set(['hello']),
      }).kind,
    ).toBe('gone');
  });
});
