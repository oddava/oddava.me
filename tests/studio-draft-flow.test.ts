import { describe, expect, it, vi } from 'vitest';
import type { ContentEntryListItem } from '../src/lib/contracts';
import { rowPatchFromNote } from '../src/components/admin/studioHelpers';
import { useStudioDraft } from '../src/components/admin/useStudioDraft';
import { adoptRestoredVersion } from '../src/components/admin/useStudioHistory';
import type {
  OpenDoc,
  StudioDocument,
} from '../src/components/admin/useStudioDocument';

// The draft pill and the paths that rewrite a note under it. Hooks run outside
// a renderer: what matters is what they write and what the list row says.
vi.mock('preact/hooks', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));

function row(
  id: string,
  extra: Partial<ContentEntryListItem> = {},
): ContentEntryListItem {
  return {
    id,
    title: id,
    folder: '',
    path: `${id}.md`,
    href: `/notes/${id}`,
    revision: 'r1',
    ...extra,
  };
}

/** A document stand-in that records what was written to it. */
function fakeDoc(open: OpenDoc, saves: boolean[] = []) {
  let pending = false;
  const doc = {
    docRef: { current: open as OpenDoc | null },
    isPaused: vi.fn(() => false),
    hasPendingWrites: vi.fn(() => pending),
    markDirty: vi.fn((next: Partial<OpenDoc>) => {
      doc.docRef.current = { ...doc.docRef.current!, ...next };
      pending = true;
    }),
    replaceFromStore: vi.fn(
      (next: Pick<OpenDoc, 'fields' | 'body' | 'revision'>) => {
        doc.docRef.current = { ...doc.docRef.current!, ...next };
        pending = false;
      },
    ),
    saveNow: vi.fn(async () => {
      const ok = saves.shift() ?? true;
      if (ok) pending = false;
      return ok;
    }),
  };
  return doc;
}

/** A list the hook can rewrite, like the workspace's `setEntries`. */
function list(initial: ContentEntryListItem[]) {
  const state = { entries: initial };
  const setEntries = vi.fn(
    (
      update:
        | ContentEntryListItem[]
        | ((items: ContentEntryListItem[]) => ContentEntryListItem[]),
    ) => {
      state.entries =
        typeof update === 'function' ? update(state.entries) : update;
    },
  );
  return { state, setEntries };
}

function draftHook(
  doc: ReturnType<typeof fakeDoc>,
  entries: ContentEntryListItem[],
  setEntries: ReturnType<typeof list>['setEntries'],
  blockedReason: string | null = null,
) {
  const notify = vi.fn();
  const onError = vi.fn();
  const hook = useStudioDraft({
    doc: doc as unknown as StudioDocument,
    openId: 'note',
    title: 'Note',
    entries,
    setEntries,
    blockedReason,
    notify,
    onError,
  });
  return { hook, notify, onError };
}

const open = (fields: Record<string, unknown>): OpenDoc => ({
  id: 'note',
  folder: '',
  fields,
  body: '# Note',
  revision: 'r1',
});

describe('rowPatchFromNote', () => {
  it('derives the title, icon and draft flag from the note', () => {
    expect(rowPatchFromNote('my-note', '# Hello\n', { icon: '🌱' })).toEqual({
      title: 'Hello',
      icon: '🌱',
      draft: undefined,
    });
    expect(rowPatchFromNote('my-note', 'no heading', { draft: true })).toEqual({
      title: 'my note',
      icon: undefined,
      draft: true,
    });
  });

  it('clears a stale flag when spread over an old row', () => {
    const stale = row('a', { draft: true, icon: 'x' });
    expect({ ...stale, ...rowPatchFromNote('a', '# A', {}) }).toMatchObject({
      draft: undefined,
      icon: undefined,
    });
  });
});

describe('the draft pill', () => {
  it('unsticks a row the note no longer agrees with', () => {
    // The row says draft, the note says published: the old pill did nothing.
    const doc = fakeDoc(open({}));
    const { state, setEntries } = list([row('note', { draft: true })]);
    const { hook } = draftHook(doc, state.entries, setEntries);
    expect(hook.state).toBe('draft');
    hook.set('published');
    expect(state.entries[0]!.draft).toBeUndefined();
    expect(doc.saveNow).not.toHaveBeenCalled();
  });

  it('does nothing while saving is paused, and says why', () => {
    const doc = fakeDoc(open({ draft: true }));
    const { state, setEntries } = list([row('note', { draft: true })]);
    const { hook, onError } = draftHook(
      doc,
      state.entries,
      setEntries,
      'Saving is paused.',
    );
    expect(hook.blockedReason).toBe('Saving is paused.');
    hook.set('published');
    expect(doc.markDirty).not.toHaveBeenCalled();
    expect(state.entries[0]!.draft).toBe(true);
    expect(onError).toHaveBeenCalledWith('Saving is paused.');
  });

  it('rolls back the pill and the note when publishing is not saved', async () => {
    const doc = fakeDoc(open({ draft: true, icon: 'i' }), [false]);
    const { state, setEntries } = list([row('note', { draft: true })]);
    const { hook, notify, onError } = draftHook(doc, state.entries, setEntries);
    hook.set('published');
    // Optimistic first: the pill moves at once.
    expect(state.entries[0]!.draft).toBeUndefined();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toContain('still a draft');
    expect(state.entries[0]!.draft).toBe(true);
    expect(doc.docRef.current!.fields).toEqual({ icon: 'i', draft: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it('confirms once the store has it', async () => {
    const doc = fakeDoc(open({ draft: true }));
    const { state, setEntries } = list([row('note', { draft: true })]);
    const { hook, notify } = draftHook(doc, state.entries, setEntries);
    hook.set('published');
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0]![0]).toContain('Published!');
    expect(doc.docRef.current!.fields).toEqual({});
  });
});

describe('adopting a restored version', () => {
  const restored = {
    ...row('note'),
    revision: 'r9',
    body: '# Older words',
    fields: { icon: 'old' },
  };

  it('replaces the note through the store path and keeps its draft flag', () => {
    const doc = fakeDoc(open({ draft: true, icon: 'new' }));
    const stored = vi.fn();
    expect(adoptRestoredVersion(doc, restored, undefined, stored)).toBe(
      'replaced',
    );
    expect(doc.replaceFromStore).toHaveBeenCalledWith({
      body: '# Older words',
      fields: { icon: 'old' },
      revision: 'r9',
    });
    // The version was published; the note is a draft and stays one, so the
    // row says draft and autosave writes the flag back.
    expect(stored).toHaveBeenCalledWith('note', 'r9', '# Older words', {
      icon: 'old',
      draft: true,
    });
    expect(doc.docRef.current!.fields).toEqual({ icon: 'old', draft: true });
    expect(doc.hasPendingWrites()).toBe(true);
  });

  it('takes the fields the server says it wrote', () => {
    const doc = fakeDoc(open({ draft: true }));
    const stored = vi.fn();
    adoptRestoredVersion(
      doc,
      restored,
      { icon: 'old', draft: true, order: 3 },
      stored,
    );
    expect(doc.replaceFromStore).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { icon: 'old', draft: true, order: 3 },
      }),
    );
    expect(doc.markDirty).not.toHaveBeenCalled();
    expect(doc.hasPendingWrites()).toBe(false);
  });

  it('does not replace text typed while the restore was out', () => {
    const doc = fakeDoc(open({}));
    doc.markDirty({ body: 'typed meanwhile' });
    const stored = vi.fn();
    expect(adoptRestoredVersion(doc, restored, undefined, stored)).toBe(
      'edited-meanwhile',
    );
    expect(doc.replaceFromStore).not.toHaveBeenCalled();
    expect(doc.docRef.current!.body).toBe('typed meanwhile');
    expect(stored).toHaveBeenCalled();
  });
});
