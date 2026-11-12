import { describe, expect, it } from 'vitest';
import type { WikiSuggestion } from '../src/components/admin/WikiLinkAutocomplete';
import {
  cycleIndex,
  findWikiSuggestion,
  keptIndex,
  rankWikiSuggestions,
  wikiTarget,
} from '../src/components/admin/studioRichSuggestions';
import { isAllowedLinkUrl } from '../src/components/admin/studioRichCommands';

function note(id: string, folder = '', title = id): WikiSuggestion {
  return {
    id,
    folder,
    title,
    href: `/notes/${[folder, id].filter(Boolean).join('/')}`,
    insert: `[[${[folder, id].filter(Boolean).join('/')}|${title}]]`,
  };
}

describe('rankWikiSuggestions', () => {
  it('keeps only fuzzy matches, best first', () => {
    const notes = [note('wash'), note('start-here'), note('zzz')];
    expect(rankWikiSuggestions('sh', notes).map((item) => item.id)).toEqual([
      'start-here',
      'wash',
    ]);
  });

  it('offers at most eight notes', () => {
    const notes = Array.from({ length: 12 }, (_, index) => note(`n${index}`));
    expect(rankWikiSuggestions('', notes)).toHaveLength(8);
  });
});

describe('keptIndex', () => {
  it('keeps the highlighted row while the query is unchanged', () => {
    expect(keptIndex({ query: 'he', index: 2 }, 'he', 5)).toBe(2);
  });

  it('clamps it to a shorter list', () => {
    expect(keptIndex({ query: 'he', index: 4 }, 'he', 2)).toBe(1);
    expect(keptIndex({ query: 'he', index: 4 }, 'he', 0)).toBe(0);
  });

  it('starts a new query at the top', () => {
    expect(keptIndex({ query: 'he', index: 3 }, 'hea', 5)).toBe(0);
    expect(keptIndex(null, 'he', 5)).toBe(0);
  });
});

describe('cycleIndex', () => {
  it('wraps in both directions', () => {
    expect(cycleIndex(2, 1, 3)).toBe(0);
    expect(cycleIndex(0, -1, 3)).toBe(2);
    expect(cycleIndex(1, 1, 3)).toBe(2);
  });

  it('stays put on an empty list', () => {
    expect(cycleIndex(0, 1, 0)).toBe(0);
  });
});

describe('wikilink targets', () => {
  const notes = [note('roadmap', 'work/2024', 'Roadmap'), note('errands')];

  it('finds a note by its full path or its bare id', () => {
    expect(findWikiSuggestion(notes, 'work/2024/roadmap')?.title).toBe(
      'Roadmap',
    );
    expect(findWikiSuggestion(notes, 'roadmap')?.title).toBe('Roadmap');
    expect(findWikiSuggestion(notes, 'missing')).toBeUndefined();
  });

  it('inserts the target an autocomplete row names, else its id', () => {
    expect(wikiTarget(notes[0]!)).toBe('work/2024/roadmap');
    expect(wikiTarget({ ...notes[1]!, insert: 'errands' })).toBe('errands');
  });
});

describe('isAllowedLinkUrl', () => {
  it('accepts web, email, site-local, and empty destinations', () => {
    for (const url of [
      'https://example.com',
      'HTTP://example.com',
      'mailto:me@example.com',
      '/notes/a',
      '#heading',
      '',
    ])
      expect(isAllowedLinkUrl(url)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const url of ['javascript:alert(1)', 'example.com', 'ftp://x'])
      expect(isAllowedLinkUrl(url)).toBe(false);
  });
});
