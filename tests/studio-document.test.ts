import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchContentEntry,
  updateContentEntry,
} from '../src/components/admin/api';
import { useStudioDocument } from '../src/components/admin/useStudioDocument';

// Exercise the document commands with one mounted set of refs. Rendering is
// irrelevant to the write queue: these commands must work between renders.
vi.mock('preact/hooks', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
vi.mock('../src/components/admin/api', () => ({
  fetchContentEntry: vi.fn(),
  updateContentEntry: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function entry(id: string) {
  return {
    entry: { id, folder: '', fields: {}, body: id, revision: 'r1' },
  } as Awaited<ReturnType<typeof fetchContentEntry>>;
}
function saved(revision: string) {
  return { result: { revision } } as Awaited<
    ReturnType<typeof updateContentEntry>
  >;
}
function mount() {
  const doc = useStudioDocument({
    collectionId: 'notes',
    onSaved: vi.fn(),
    onError: vi.fn(),
  });
  doc.setAutosave(false);
  return doc;
}

beforeEach(() => {
  vi.stubGlobal('window', { clearTimeout, setTimeout });
  vi.mocked(fetchContentEntry).mockImplementation(async (_collection, id) =>
    entry(id),
  );
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('Studio document transitions', () => {
  it('keeps unsaved edits when a failed save still cannot be retried', async () => {
    const doc = mount();
    await doc.open('a');
    doc.markDirty({ body: 'precious edits' });
    vi.mocked(updateContentEntry).mockRejectedValue(new Error('offline'));
    expect(await doc.saveNow()).toBe(false);
    await expect(doc.open('b')).rejects.toThrow('Save the current note');
    expect(doc.docRef.current).toMatchObject({
      id: 'a',
      body: 'precious edits',
    });
    expect(doc.hasPendingWrites()).toBe(true);
    vi.mocked(updateContentEntry).mockResolvedValue(saved('r2'));
    await doc.open('b');
    expect(doc.docRef.current?.id).toBe('b');
  });

  it('keeps the latest selection when loads resolve out of order', async () => {
    const doc = mount();
    await doc.open('a');
    const slow = deferred<ReturnType<typeof entry>>();
    vi.mocked(fetchContentEntry).mockImplementation(async (_collection, id) =>
      id === 'b' ? slow.promise : entry(id),
    );
    const openingB = doc.open('b');
    await doc.open('c');
    slow.resolve(entry('b'));
    expect(await openingB).toBeNull();
    expect(doc.docRef.current?.id).toBe('c');
  });

  it('cancels a pending selection when the current note is selected again', async () => {
    const doc = mount();
    await doc.open('a');
    const slow = deferred<ReturnType<typeof entry>>();
    vi.mocked(fetchContentEntry).mockReturnValue(slow.promise);
    const openingB = doc.open('b');
    await doc.open('a');
    slow.resolve(entry('b'));
    expect(await openingB).toBeNull();
    expect(doc.docRef.current?.id).toBe('a');
  });

  it('saves edits made during loading and drains edits made during that save', async () => {
    const doc = mount();
    await doc.open('a');
    const loading = deferred<ReturnType<typeof entry>>();
    const writing = deferred<ReturnType<typeof saved>>();
    const started = deferred<void>();
    vi.mocked(fetchContentEntry).mockReturnValue(loading.promise);
    vi.mocked(updateContentEntry)
      .mockImplementationOnce(() => {
        started.resolve();
        return writing.promise;
      })
      .mockResolvedValue(saved('r3'));
    const opening = doc.open('b');
    doc.markDirty({ body: 'during load' });
    loading.resolve(entry('b'));
    await started.promise;
    doc.markDirty({ body: 'during save' });
    writing.resolve(saved('r2'));
    await opening;
    expect(updateContentEntry).toHaveBeenNthCalledWith(
      1,
      'notes',
      'a',
      expect.objectContaining({ body: 'during load', revision: 'r1' }),
    );
    expect(updateContentEntry).toHaveBeenNthCalledWith(
      2,
      'notes',
      'a',
      expect.objectContaining({ body: 'during save', revision: 'r2' }),
    );
    expect(doc.docRef.current?.id).toBe('b');
    expect(doc.hasPendingWrites()).toBe(false);
  });

  it('leaves the active document untouched after a load failure', async () => {
    const doc = mount();
    await doc.open('a');
    doc.markDirty({ body: 'unsaved' });
    vi.mocked(fetchContentEntry).mockRejectedValue(new Error('offline'));
    await expect(doc.open('b')).rejects.toThrow('offline');
    expect(doc.docRef.current).toMatchObject({ id: 'a', body: 'unsaved' });
    expect(updateContentEntry).not.toHaveBeenCalled();
  });
});
