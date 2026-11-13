import { describe, expect, it } from 'vitest';
import {
  CLEAR,
  choose,
  isPaused,
  observe,
  saved,
  sameContent,
  type ConflictState,
  type LocalNote,
  type NoteVersion,
  type Reading,
} from '../src/components/admin/studioConflict';

const note = (
  revision: string,
  body: string,
  fields: Record<string, unknown> = {},
): NoteVersion => ({ revision, body, fields });
const found = (version: NoteVersion): Reading => ({
  kind: 'found',
  note: version,
});
const local = (
  revision: string,
  body: string,
  dirty: boolean,
  fields: Record<string, unknown> = {},
): LocalNote => ({ revision, body, fields, dirty });

describe('observe', () => {
  it('stays clear while the store still has our revision', () => {
    const outcome = observe(
      CLEAR,
      found(note('r1', 'a')),
      local('r1', 'a', false),
    );
    expect(outcome).toEqual({ state: CLEAR, effect: { type: 'none' } });
  });

  it('silently loads their version when there are no local edits', () => {
    const theirs = note('r2', 'edited elsewhere');
    const outcome = observe(CLEAR, found(theirs), local('r1', 'a', false));
    expect(outcome.state).toEqual(CLEAR);
    expect(outcome.effect).toEqual({ type: 'load', theirs, quiet: true });
  });

  it('holds the banner when a stale save finds local edits', () => {
    const theirs = note('r2', 'theirs');
    const outcome = observe(CLEAR, found(theirs), local('r1', 'mine', true));
    expect(outcome.state).toEqual({
      kind: 'changed',
      theirs,
      again: false,
      aside: null,
    });
    expect(outcome.effect).toEqual({ type: 'none' });
    expect(isPaused(outcome.state)).toBe(true);
  });

  it('does not nag when polling sees the revision the banner already shows', () => {
    const theirs = note('r2', 'theirs');
    const first = observe(CLEAR, found(theirs), local('r1', 'mine', true));
    const next = observe(first.state, found(theirs), local('r1', 'mine', true));
    expect(next.state).toBe(first.state);
  });

  it('adopts the revision when both sides hold the same words', () => {
    const outcome = observe(
      CLEAR,
      found(note('r2', 'same', { icon: 'x' })),
      local('r1', 'same', true, { icon: 'x' }),
    );
    expect(outcome.state).toEqual(CLEAR);
    expect(outcome.effect).toEqual({ type: 'adopt-revision', revision: 'r2' });
  });

  it('treats key order in fields as the same content', () => {
    expect(
      sameContent(
        { body: 'a', fields: { a: 1, b: { c: 2, d: 3 } } },
        { body: 'a', fields: { b: { d: 3, c: 2 }, a: 1 } },
      ),
    ).toBe(true);
    expect(
      sameContent(
        { body: 'a', fields: { icon: 'x' } },
        { body: 'a', fields: {} },
      ),
    ).toBe(false);
  });

  it('releases the pause when the store returns to our revision', () => {
    const paused = observe(
      CLEAR,
      found(note('r2', 'theirs')),
      local('r1', 'mine', true),
    ).state;
    const outcome = observe(
      paused,
      found(note('r1', 'mine')),
      local('r1', 'mine', true),
    );
    expect(outcome.state).toEqual(CLEAR);
    expect(isPaused(outcome.state)).toBe(false);
  });

  describe('deleted or moved elsewhere', () => {
    it('is gone even with no local edits, since there is nothing to refresh to', () => {
      const outcome = observe(
        CLEAR,
        { kind: 'missing' },
        local('r1', 'a', false),
      );
      expect(outcome.state).toEqual({ kind: 'gone' });
      expect(outcome.effect).toEqual({ type: 'none' });
      expect(isPaused(outcome.state)).toBe(true);
    });

    it('is gone when a save gets a not-found', () => {
      const outcome = observe(
        CLEAR,
        { kind: 'missing' },
        local('r1', 'mine', true),
      );
      expect(outcome.state).toEqual({ kind: 'gone' });
    });

    it('keeps the same state on repeated polls', () => {
      const gone: ConflictState = { kind: 'gone' };
      const outcome = observe(
        gone,
        { kind: 'missing' },
        local('r1', 'a', true),
      );
      expect(outcome.state).toBe(gone);
    });

    it('lifts when the note comes back at the revision we hold', () => {
      const outcome = observe(
        { kind: 'gone' },
        found(note('r1', 'a')),
        local('r1', 'a', false),
      );
      expect(outcome.state).toEqual(CLEAR);
    });
  });

  describe('double conflict', () => {
    it('marks a newer change arriving on top of an unresolved one', () => {
      const first = observe(
        CLEAR,
        found(note('r2', 'theirs')),
        local('r1', 'mine', true),
      ).state;
      const second = observe(
        first,
        found(note('r3', 'theirs, again')),
        local('r1', 'mine', true),
      ).state;
      expect(second).toMatchObject({
        kind: 'changed',
        again: true,
        theirs: { revision: 'r3' },
      });
    });

    it('marks a refusal of the overwrite itself', () => {
      const overwriting: ConflictState = {
        kind: 'overwriting',
        theirs: note('r2', 'theirs'),
      };
      const outcome = observe(
        overwriting,
        found(note('r3', 'theirs v2')),
        local('r2', 'mine', true),
      );
      expect(outcome.state).toMatchObject({ kind: 'changed', again: true });
      expect(isPaused(outcome.state)).toBe(true);
    });

    it('keeps text set aside earlier when another change lands', () => {
      const aside = { body: 'first mine', fields: {} };
      const outcome = observe(
        { kind: 'set-aside', mine: aside },
        found(note('r4', 'theirs v3')),
        local('r2', 'edited after loading', true),
      );
      expect(outcome.state).toMatchObject({ kind: 'changed', aside });
    });
  });

  it('leaves set-aside text alone when a quiet refresh happens', () => {
    const aside: ConflictState = {
      kind: 'set-aside',
      mine: { body: 'mine', fields: {} },
    };
    const outcome = observe(
      aside,
      found(note('r3', 'x')),
      local('r2', 'y', false),
    );
    expect(outcome.state).toBe(aside);
    expect(outcome.effect.type).toBe('load');
  });
});

describe('choose', () => {
  const theirs = note('r2', 'theirs', { icon: 'star' });
  const changed: ConflictState = {
    kind: 'changed',
    theirs,
    again: false,
    aside: null,
  };
  const mine = local('r1', 'my words', true);

  it('load-theirs replaces the note and sets our text aside', () => {
    const outcome = choose(changed, 'load-theirs', mine);
    expect(outcome.effect).toEqual({ type: 'load', theirs, quiet: false });
    expect(outcome.state).toEqual({
      kind: 'set-aside',
      mine: { body: 'my words', fields: {} },
    });
    expect(isPaused(outcome.state)).toBe(false);
  });

  it('load-theirs sets nothing aside when our text equals theirs', () => {
    const outcome = choose(
      changed,
      'load-theirs',
      local('r1', 'theirs', true, { icon: 'star' }),
    );
    expect(outcome.state).toEqual(CLEAR);
  });

  it('keep-mine adopts their revision to overwrite and resumes saving', () => {
    const outcome = choose(changed, 'keep-mine', mine);
    expect(outcome.effect).toEqual({ type: 'overwrite', revision: 'r2' });
    expect(outcome.state).toEqual({ kind: 'overwriting', theirs });
    expect(isPaused(outcome.state)).toBe(false);
  });

  it('a successful save settles an overwrite', () => {
    expect(saved({ kind: 'overwriting', theirs })).toEqual(CLEAR);
    expect(saved(changed)).toBe(changed);
  });

  it('restore-mine puts the set-aside text back as an edit', () => {
    const aside = { body: 'my words', fields: {} };
    const outcome = choose(
      { kind: 'set-aside', mine: aside },
      'restore-mine',
      local('r2', 'theirs', false),
    );
    expect(outcome.effect).toEqual({ type: 'restore', text: aside });
    expect(outcome.state).toEqual(CLEAR);
  });

  it('dismissing the set-aside notice forgets that text', () => {
    const outcome = choose(
      { kind: 'set-aside', mine: { body: 'x', fields: {} } },
      'dismiss-aside',
      local('r2', 'theirs', false),
    );
    expect(outcome).toEqual({ state: CLEAR, effect: { type: 'none' } });
  });

  it('offers recreate and close for a note that is gone', () => {
    const gone: ConflictState = { kind: 'gone' };
    expect(choose(gone, 'recreate', mine)).toEqual({
      state: gone,
      effect: { type: 'recreate' },
    });
    expect(choose(gone, 'close', mine)).toEqual({
      state: CLEAR,
      effect: { type: 'close' },
    });
    expect(saved(gone)).toEqual(CLEAR);
  });

  it('ignores a choice that does not belong to the state', () => {
    expect(choose(CLEAR, 'keep-mine', mine)).toEqual({
      state: CLEAR,
      effect: { type: 'none' },
    });
    expect(choose(changed, 'recreate', mine).effect.type).toBe('none');
  });
});
