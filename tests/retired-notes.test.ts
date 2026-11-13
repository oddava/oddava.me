import { describe, expect, it } from 'vitest';
import { decidePublicNote } from '../src/lib/garden/retired';
import {
  followNoteRedirect,
  isPublicTombstone,
  parseRetiredPayload,
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

describe('public retirement never reveals a draft', () => {
  // What READ_RETIRED_SCRIPT returns: each tombstone described, not returned.
  const payload = JSON.stringify({
    redirects: ['old/secret', 'diary/secret', 'old/gone', 'diary/gone'],
    tombstones: [
      { path: 'diary/secret', draft: true },
      { path: 'diary/gone', draft: false },
      // Trashed before the marker existed: read from their frontmatter.
      { path: 'legacy/plain', frontmatter: '' },
      { path: 'legacy/titled', frontmatter: '---\ntitle: x\n---' },
      { path: 'legacy/draft', frontmatter: '---\ndraft: true\n---' },
      { path: 'legacy/quoted', frontmatter: "---\r\ndraft: 'TRUE'\r\n---" },
      // Unparseable frontmatter fails closed, like a live note.
      { path: 'legacy/broken', frontmatter: '---\ndraft: true\nimage: [\n---' },
      // Undecodable: hidden.
      { path: 'legacy/garbled' },
    ],
  });

  it('keeps draft tombstones out of the public set', () => {
    expect([...parseRetiredPayload(payload).tombstones].toSorted()).toEqual([
      'diary/gone',
      'legacy/plain',
      'legacy/titled',
    ]);
    // An empty hash encodes as `{}` in cjson.
    expect(
      parseRetiredPayload('{"redirects":{},"tombstones":{}}').tombstones.size,
    ).toBe(0);
  });

  it('answers 404, not 410, for a trashed draft and redirects ending at it', () => {
    const retired = parseRetiredPayload(payload);
    expect(decidePublicNote('diary/secret', [], retired).kind).toBe('missing');
    expect(decidePublicNote('old/secret', [], retired).kind).toBe('missing');
    expect(decidePublicNote('diary/gone', [], retired).kind).toBe('gone');
    expect(decidePublicNote('old/gone', [], retired).kind).toBe('gone');
  });

  it('describes each tombstone conservatively', () => {
    expect(isPublicTombstone({ path: 'a', draft: false })).toBe(true);
    expect(isPublicTombstone({ path: 'a', draft: true })).toBe(false);
    expect(isPublicTombstone({ path: 'a' })).toBe(false);
    expect(isPublicTombstone({ draft: false })).toBe(false);
    expect(isPublicTombstone('a')).toBe(false);
  });
});
