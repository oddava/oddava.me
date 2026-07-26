import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteSocialCard,
  noteSocialCardImage,
  socialCardKey,
} from '../src/lib/garden/og-card';
import { drawSocialCard } from '../src/components/admin/socialCard';

type Note = { path: string; title: string; updated: string };

const runtime = vi.hoisted(() => ({
  notes: [] as { path: string; title: string; updated: string }[],
  cards: new Map<string, Uint8Array>(),
  storeDown: false,
  files: new Map<string, { revision: string }>(),
  writes: 0,
}));

vi.mock('@lib/garden', () => ({
  getGardenIndexOrUnavailable: async () =>
    runtime.storeDown
      ? { ok: false, response: new Response(null, { status: 503 }) }
      : { ok: true, index: { documents: runtime.notes } },
}));

vi.mock('@lib/server/content', () => ({
  readSocialCard: async (path: string, fingerprint: string) =>
    runtime.cards.get(`${path}.${fingerprint}`) ?? null,
}));

vi.mock('@lib/server/core', () => ({
  isStorageUnavailableError: () => false,
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisBinaryFile: async () => null,
  createRedisContentProvider: () => ({
    listFilePaths: async (directory: string, extension: string) =>
      [...runtime.files.keys()].filter(
        (path) =>
          path.startsWith(`${directory}/`) && path.endsWith(`.${extension}`),
      ),
    readFile: async (path: string) => {
      const file = runtime.files.get(path);
      return file ? { path, revision: file.revision } : null;
    },
    writeBinaryFile: async (path: string) => {
      runtime.writes += 1;
      runtime.files.set(path, { revision: 'r-new' });
      return { message: '' };
    },
    deleteFile: async (path: string, _message: string, revision: string) => {
      if (runtime.files.get(path)?.revision !== revision) {
        throw new Error('revision conflict');
      }
      runtime.files.delete(path);
      return { message: '' };
    },
  }),
}));

const NOTE: Note = {
  path: 'reading/books',
  title: 'What I read in 2026',
  updated: '2026-03-11T09:00:00.000Z',
};

function loadRoute() {
  return import('../src/pages/og/[...path].png');
}

describe('note social card identity', () => {
  it('names the garden root card `index`', () => {
    expect(socialCardKey('')).toBe('index');
    expect(socialCardKey('/reading//books/')).toBe('reading/books');
  });

  it('carries the note text a card shows, with its folder as a breadcrumb', () => {
    expect(noteSocialCard(NOTE)).toMatchObject({
      path: 'reading/books',
      title: 'What I read in 2026',
      folder: 'Reading',
      // The same UTC calendar day the note page prints, not the local one.
      date: 'March 11, 2026',
    });
  });

  it('changes the fingerprint only when the drawn text changes', () => {
    const base = noteSocialCard(NOTE).fingerprint;

    expect(noteSocialCard({ ...NOTE }).fingerprint).toBe(base);
    // The body is not on the card, so editing it must not orphan the card.
    expect(
      noteSocialCard({ ...NOTE, updated: '2026-03-11T23:59:00.000Z' })
        .fingerprint,
    ).toBe(base);

    expect(noteSocialCard({ ...NOTE, title: 'Other' }).fingerprint).not.toBe(
      base,
    );
    expect(
      noteSocialCard({ ...NOTE, path: 'writing/books' }).fingerprint,
    ).not.toBe(base);
    expect(
      noteSocialCard({ ...NOTE, updated: '2026-03-12T09:00:00.000Z' })
        .fingerprint,
    ).not.toBe(base);
  });

  it('points a note at its own card, fingerprinted for cache busting', () => {
    const { fingerprint } = noteSocialCard(NOTE);
    expect(noteSocialCardImage(NOTE)).toEqual({
      src: `/og/reading/books.png?v=${fingerprint}`,
      alt: 'What I read in 2026 — oddava.me',
    });
  });
});

describe('/og/[...path].png', () => {
  beforeEach(() => {
    runtime.notes = [NOTE, { path: '', title: 'notes', updated: '2026-01-02' }];
    runtime.cards = new Map();
    runtime.storeDown = false;
    vi.resetModules();
  });

  it('serves the stored card for a note', async () => {
    const { fingerprint } = noteSocialCard(NOTE);
    runtime.cards.set(
      `reading/books.${fingerprint}`,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );

    const { GET } = await loadRoute();
    const response = await GET({ params: { path: 'reading/books' } } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('4');
  });

  it('resolves the garden root as `index`', async () => {
    const { fingerprint } = noteSocialCard({
      path: '',
      title: 'notes',
      updated: '2026-01-02',
    });
    runtime.cards.set(`index.${fingerprint}`, new Uint8Array([1]));

    const { GET } = await loadRoute();
    expect((await GET({ params: { path: 'index' } } as never)).status).toBe(
      200,
    );
  });

  it('falls back to the default card when a note has none yet', async () => {
    const { GET } = await loadRoute();
    const response = await GET({ params: { path: 'reading/books' } } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/og-default.png');
  });

  it('never serves a card drawn for text the note no longer has', async () => {
    // A card stored under a superseded fingerprint stays unreachable: the route
    // derives the current one from the live index rather than trusting a URL.
    runtime.cards.set('reading/books.stale00', new Uint8Array([1]));

    const { GET } = await loadRoute();
    expect(
      (await GET({ params: { path: 'reading/books' } } as never)).status,
    ).toBe(302);
  });

  it('falls back for an unknown note and for an unavailable store', async () => {
    const { GET } = await loadRoute();
    expect((await GET({ params: { path: 'nope' } } as never)).status).toBe(302);

    runtime.storeDown = true;
    expect(
      (await GET({ params: { path: 'reading/books' } } as never)).status,
    ).toBe(302);
  });
});

describe('social card storage', () => {
  beforeEach(() => {
    runtime.files = new Map();
    runtime.writes = 0;
  });

  it('drops a note’s superseded cards but leaves its descendants alone', async () => {
    const { writeSocialCard, listSocialCardKeys } =
      await import('../src/lib/server/content/social-cards');
    const directory = 'public/images/og/notes';
    runtime.files.set(`${directory}/reading.old111.png`, { revision: 'r1' });
    runtime.files.set(`${directory}/reading.old222.png`, { revision: 'r2' });
    // A different note whose key shares the prefix — pruning must not take it.
    runtime.files.set(`${directory}/reading/books.keep11.png`, {
      revision: 'r3',
    });

    await writeSocialCard('reading', 'new333', new Uint8Array([1]));

    expect([...(await listSocialCardKeys())].toSorted()).toEqual([
      'reading.new333',
      'reading/books.keep11',
    ]);
  });

  it('re-rendering identical text writes nothing', async () => {
    const { writeSocialCard } =
      await import('../src/lib/server/content/social-cards');

    await writeSocialCard('reading', 'same11', new Uint8Array([1]));
    await writeSocialCard('reading', 'same11', new Uint8Array([1]));

    expect(runtime.writes).toBe(1);
  });
});

/** Records what the card draws, and measures text at roughly half an em. */
function stubContext() {
  const text: { value: string; size: number }[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    size(): number {
      return Number(context.font.match(/(\d+)px/)?.[1] ?? 16);
    },
    measureText: (value: string) => ({
      width: value.length * context.size() * 0.5,
    }),
    fillText: (value: string) => text.push({ value, size: context.size() }),
  };
  return { context, text };
}

describe('social card artwork', () => {
  it('prints the note’s title, folder and date', () => {
    const { context, text } = stubContext();
    drawSocialCard(context as never, {
      path: 'reading/books',
      title: 'Short title',
      folder: 'Reading',
      date: 'March 11, 2026',
    });

    const printed = text.map((entry) => entry.value);
    expect(printed).toContain('Short title');
    expect(printed).toContain('Reading');
    expect(printed).toContain('March 11, 2026');
    expect(printed).toContain('/notes/reading/books');
  });

  it('steps the title down a size rather than overrunning the card', () => {
    const { context, text } = stubContext();
    const title = 'A deliberately long note title that cannot fit on one line';
    drawSocialCard(context as never, {
      path: 'index',
      title,
      folder: '',
      date: 'March 11, 2026',
    });

    const titleLines = text.filter((entry) => entry.size > 40);
    expect(titleLines.length).toBeGreaterThan(1);
    expect(titleLines.length).toBeLessThanOrEqual(3);
    expect(titleLines[0]!.size).toBeLessThan(76);
    expect(titleLines.map((entry) => entry.value).join(' ')).toBe(title);
  });

  it('truncates a title too long to fit even at the smallest size', () => {
    const { context, text } = stubContext();
    drawSocialCard(context as never, {
      path: 'index',
      title: 'word '.repeat(80).trim(),
      folder: '',
      date: 'March 11, 2026',
    });

    const titleLines = text.filter((entry) => entry.size > 40);
    expect(titleLines).toHaveLength(3);
    expect(titleLines.at(-1)!.value.endsWith('…')).toBe(true);
  });
});
