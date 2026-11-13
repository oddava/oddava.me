import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createContentEntry,
  fetchContentEntry,
  updateContentEntry,
} from '../src/components/admin/api';
import { useStudioConflict } from '../src/components/admin/useStudioConflict';
import { useStudioDocument } from '../src/components/admin/useStudioDocument';

// The document and the conflict hook mounted together, the way the workspace
// wires them, with one set of refs. Rendering is irrelevant here: these are
// the state transitions between renders, where text used to go missing.
vi.mock('preact/hooks', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
vi.mock('../src/components/admin/api', () => ({
  createContentEntry: vi.fn(),
  fetchContentEntry: vi.fn(),
  updateContentEntry: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

type Entry = Awaited<ReturnType<typeof fetchContentEntry>>;
type Write = Awaited<ReturnType<typeof updateContentEntry>>;

function entry(id: string, body = id, revision = 'r1'): Entry {
  return { entry: { id, folder: '', fields: {}, body, revision } } as Entry;
}
const written = (revision: string) => ({ result: { revision } }) as Write;
const refused = (code: string) =>
  Object.assign(new Error(code), { code }) as Error & { code: string };

function mount(options: { editing?: boolean } = {}) {
  const onAdopted = vi.fn();
  const onNotice = vi.fn();
  const onError = vi.fn();
  let rejected: (reason: 'stale' | 'gone') => void = () => {};
  const doc = useStudioDocument({
    collectionId: 'notes',
    onSaved: vi.fn(),
    onError: vi.fn(),
    onSaveRejected: (reason) => rejected(reason),
  });
  const conflict = useStudioConflict({
    collectionId: 'notes',
    doc,
    onAdopted,
    onGone: vi.fn(),
    onNotice,
    onError,
    isEditing: () => options.editing ?? false,
  });
  rejected = conflict.handleSaveRejected;
  return { doc, conflict, onAdopted, onNotice, onError };
}

/** Let queued promise callbacks run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    clearTimeout,
    setTimeout,
    setInterval,
    clearInterval,
  });
  vi.mocked(fetchContentEntry).mockImplementation(async (_c, id) => entry(id));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('a note deleted elsewhere, saved again here', () => {
  async function gone() {
    const mounted = mount();
    await mounted.doc.open('a');
    mounted.doc.markDirty({ body: 'first words' });
    vi.mocked(updateContentEntry).mockRejectedValueOnce(refused('not_found'));
    expect(await mounted.doc.saveNow()).toBe(false);
    expect(mounted.conflict.state).toBeDefined();
    // The conflict hook paused saving the moment the save was refused.
    expect(mounted.doc.isPaused()).toBe(true);
    return mounted;
  }

  it('keeps what was typed while the create request was out', async () => {
    const { doc, conflict, onAdopted } = await gone();
    const creating = deferred<Write>();
    vi.mocked(createContentEntry).mockReturnValue(
      creating.promise as ReturnType<typeof createContentEntry>,
    );

    const picking = conflict.pick('recreate');
    await settle();
    expect(createContentEntry).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({ body: 'first words' }),
    );
    // Typing goes on while the request is out.
    doc.setBody('first words, and more');
    doc.markDirty({ body: 'first words, and more' });
    creating.resolve(written('r2'));
    await picking;

    expect(doc.docRef.current).toMatchObject({
      revision: 'r2',
      body: 'first words, and more',
    });
    // Only what the request carried is saved; the rest is still to send.
    expect(doc.hasPendingWrites()).toBe(true);
    expect(doc.isPaused()).toBe(false);
    expect(onAdopted).toHaveBeenCalledWith('a', 'r2', 'first words', {});

    vi.mocked(updateContentEntry).mockResolvedValue(written('r3'));
    await vi.runOnlyPendingTimersAsync();
    expect(updateContentEntry).toHaveBeenLastCalledWith(
      'notes',
      'a',
      expect.objectContaining({
        body: 'first words, and more',
        revision: 'r2',
      }),
    );
    expect(doc.hasPendingWrites()).toBe(false);
  });

  it('marks everything saved when nothing was typed meanwhile', async () => {
    const { doc, conflict } = await gone();
    vi.mocked(createContentEntry).mockResolvedValue(written('r2'));
    await conflict.pick('recreate');
    expect(doc.hasPendingWrites()).toBe(false);
    expect(doc.docRef.current?.revision).toBe('r2');
  });

  it('leaves another note alone when the response lands after a switch', async () => {
    const { doc, conflict, onAdopted } = await gone();
    const creating = deferred<Write>();
    vi.mocked(createContentEntry).mockReturnValue(
      creating.promise as ReturnType<typeof createContentEntry>,
    );
    const picking = conflict.pick('recreate');
    await settle();
    // Closing drops the text; something else opens in its place.
    doc.closeIfOpen('a');
    await doc.open('b');
    creating.resolve(written('r9'));
    await picking;
    expect(doc.docRef.current).toMatchObject({ id: 'b', revision: 'r1' });
    // The list still learns that `a` exists again.
    expect(onAdopted).toHaveBeenCalledWith('a', 'r9', 'first words', {});
  });
});

describe('keep mine', () => {
  it('sends edits made during the overwrite after it', async () => {
    const { doc, conflict } = mount();
    await doc.open('a');
    doc.markDirty({ body: 'mine' });
    vi.mocked(updateContentEntry).mockRejectedValueOnce(
      refused('revision_conflict'),
    );
    vi.mocked(fetchContentEntry).mockResolvedValueOnce(
      entry('a', 'theirs', 'r5'),
    );
    await doc.saveNow();
    await settle();
    expect(conflict.state).toBeDefined();
    expect(doc.isPaused()).toBe(true);

    const overwriting = deferred<Write>();
    vi.mocked(updateContentEntry).mockReturnValueOnce(overwriting.promise);
    const picking = conflict.pick('keep-mine');
    await settle();
    doc.markDirty({ body: 'mine, still typing' });
    overwriting.resolve(written('r6'));
    await picking;

    expect(updateContentEntry).toHaveBeenLastCalledWith(
      'notes',
      'a',
      expect.objectContaining({ body: 'mine', revision: 'r5' }),
    );
    expect(doc.hasPendingWrites()).toBe(true);
    vi.mocked(updateContentEntry).mockResolvedValue(written('r7'));
    await vi.runOnlyPendingTimersAsync();
    expect(updateContentEntry).toHaveBeenLastCalledWith(
      'notes',
      'a',
      expect.objectContaining({ body: 'mine, still typing', revision: 'r6' }),
    );
    expect(doc.hasPendingWrites()).toBe(false);
  });
});

describe('who pauses saving', () => {
  it('is the conflict hook alone, and a failed read retries on one timer', async () => {
    const { doc, conflict } = mount();
    await doc.open('a');
    doc.markDirty({ body: 'mine' });
    vi.mocked(fetchContentEntry).mockRejectedValue(new Error('offline'));
    // Two refusals in a row, each followed by a read that fails.
    conflict.handleSaveRejected('stale');
    expect(doc.isPaused()).toBe(true);
    await settle();
    conflict.handleSaveRejected('stale');
    await settle();
    expect(vi.getTimerCount()).toBe(1);

    vi.mocked(updateContentEntry).mockResolvedValue(written('r2'));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(doc.isPaused()).toBe(false);
  });

  it('does not pause when used without the conflict hook', async () => {
    const doc = useStudioDocument({
      collectionId: 'notes',
      onSaved: vi.fn(),
      onError: vi.fn(),
    });
    await doc.open('a');
    doc.markDirty({ body: 'x' });
    vi.mocked(updateContentEntry).mockRejectedValueOnce(
      refused('revision_conflict'),
    );
    expect(await doc.saveNow()).toBe(false);
    expect(doc.isPaused()).toBe(false);
  });
});

describe('a quiet refresh', () => {
  async function changedElsewhere(editing: boolean) {
    const mounted = mount({ editing });
    await mounted.doc.open('a');
    mounted.doc.markDirty({ body: 'saved words' });
    vi.mocked(updateContentEntry).mockResolvedValueOnce(written('r2'));
    await mounted.doc.saveNow();
    // Their save lands; ours is refused against it.
    vi.mocked(fetchContentEntry).mockResolvedValueOnce(
      entry('a', 'their words', 'r3'),
    );
    mounted.conflict.handleSaveRejected('stale');
    await settle();
    return mounted;
  }

  it('replaces the note when nobody is typing in it', async () => {
    const { doc, onAdopted } = await changedElsewhere(false);
    expect(doc.docRef.current).toMatchObject({
      body: 'their words',
      revision: 'r3',
    });
    expect(onAdopted).toHaveBeenCalledWith('a', 'r3', 'their words', {});
  });

  it('asks instead while the author is editing', async () => {
    const { doc, onAdopted } = await changedElsewhere(true);
    expect(doc.docRef.current).toMatchObject({
      body: 'saved words',
      revision: 'r2',
    });
    expect(doc.isPaused()).toBe(true);
    expect(onAdopted).not.toHaveBeenCalled();
  });
});
