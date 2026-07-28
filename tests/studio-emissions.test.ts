import { describe, expect, it } from 'vitest';
import {
  EMITTED_MEMORY,
  emissionsFrom,
  isOurs,
  remember,
} from '../src/components/admin/studioEmissions';

describe('studioEmissions', () => {
  it('recognises the document it was seeded with', () => {
    expect(isOurs(emissionsFrom('hello'), 'hello')).toBe(true);
  });

  it('does not claim a document it never saw', () => {
    expect(isOurs(emissionsFrom('hello'), 'a different note')).toBe(false);
  });

  // The bug this exists for. The editor hands a document upward and gets it
  // back as a prop, and the check for "is this mine?" runs in an effect —
  // which runs after paint. Typing fast enough to emit again before that
  // effect flushes hands it an *older* document than the newest emitted one.
  // Against a single slot that reads as a document from somewhere else: the
  // editor closes the block mid-word and, having put the older value back in
  // the slot, guarantees the next check fails too.
  it('still recognises an older document that arrives late', () => {
    const seen = emissionsFrom('hell');
    remember(seen, 'hello');
    remember(seen, 'hellow');
    remember(seen, 'hellowo');
    // A render observed while `hello` was current only reaches the check now.
    expect(isOurs(seen, 'hello')).toBe(true);
    expect(isOurs(seen, 'hellowo')).toBe(true);
  });

  it('forgets the oldest once the run is full', () => {
    const seen = emissionsFrom('first');
    for (let index = 0; index < EMITTED_MEMORY; index += 1) {
      remember(seen, `edit ${index}`);
    }
    expect(seen.size).toBe(EMITTED_MEMORY);
    expect(isOurs(seen, 'first')).toBe(false);
    expect(isOurs(seen, `edit ${EMITTED_MEMORY - 1}`)).toBe(true);
  });

  // Undo, or typing a character and deleting it again, both legitimately
  // return the document to a state already seen. That has to count as recent,
  // not as something near the eviction end.
  it('moves a document already known back to the front', () => {
    const seen = emissionsFrom('a');
    remember(seen, 'b');
    remember(seen, 'a');
    for (let index = 0; index < EMITTED_MEMORY - 1; index += 1) {
      remember(seen, `filler ${index}`);
    }
    expect(isOurs(seen, 'a')).toBe(true);
    expect(isOurs(seen, 'b')).toBe(false);
  });
});
