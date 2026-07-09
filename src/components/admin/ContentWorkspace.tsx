import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { marked } from 'marked';
import {
  deleteContentDraft,
  deleteContentMedia,
  fetchContentCollections,
  fetchContentDraft,
  fetchContentEntries,
  fetchContentHistory,
  fetchContentMedia,
  fetchContentSurfaces,
  publishContentDraft,
  restoreContentRevision,
  saveContentDraft,
  uploadContentMedia,
} from './api';
import type {
  ContentBlock,
  ContentCollectionMeta,
  ContentDraft,
  ContentEntryListItem,
  ContentFieldDefinition,
  ContentRevision,
  ContentSurface,
  MediaAsset,
  PublishJob,
} from './types';
import { useDialogConfirm } from './useDialogConfirm';
import './Studio.css';

interface ContentWorkspaceProps {
  onContentChanged?: () => Promise<void>;
  fullWidth?: boolean;
}

type EditorMode = 'empty' | 'new' | 'edit';
type ProviderState = 'local' | 'unavailable';
type ViewMode = 'write' | 'split' | 'preview';

const LAYOUT_STORAGE_KEY = 'oddava.studio.layout';
const PANE_BOUNDS = {
  library: { min: 190, max: 380 },
  inspector: { min: 260, max: 460 },
} as const;

type Pane = keyof typeof PANE_BOUNDS;

interface StudioLayout {
  library: number;
  inspector: number;
  view: ViewMode;
}

const DEFAULT_LAYOUT: StudioLayout = {
  library: 240,
  inspector: 300,
  view: 'split',
};

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'split', label: 'Split' },
  { id: 'preview', label: 'Preview' },
];

marked.setOptions({ gfm: true, breaks: false });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readLayout(): StudioLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<StudioLayout>;
    const view = VIEW_MODES.some((mode) => mode.id === parsed.view)
      ? (parsed.view as ViewMode)
      : DEFAULT_LAYOUT.view;
    return {
      view,
      library: clamp(
        Number(parsed.library) || DEFAULT_LAYOUT.library,
        PANE_BOUNDS.library.min,
        PANE_BOUNDS.library.max,
      ),
      inspector: clamp(
        Number(parsed.inspector) || DEFAULT_LAYOUT.inspector,
        PANE_BOUNDS.inspector.min,
        PANE_BOUNDS.inspector.max,
      ),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Templates still ship `blocks`; render them once into the Markdown source. */
function blocksToMarkdown(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const level = clamp(block.level ?? 2, 1, 3);
        return `${'#'.repeat(level)} ${block.value ?? ''}`.trimEnd();
      }
      if (block.type === 'image') {
        return `![${block.alt ?? ''}](${block.src ?? ''})`;
      }
      if (block.type === 'code') {
        return `\`\`\`${block.language ?? ''}\n${block.value ?? ''}\n\`\`\``;
      }
      if (block.type === 'callout') {
        const title = block.title?.trim() || 'Note';
        const content = (block.value ?? '')
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join('\n');
        return [`> [!NOTE] ${title}`, content].filter(Boolean).join('\n');
      }
      return block.value ?? '';
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

function defaultValue(field: ContentFieldDefinition): unknown {
  if (field.type === 'boolean') return false;
  if (field.type === 'string-list') return [];
  if (field.type === 'date' && field.name === 'date') return today();
  return '';
}

function defaultFields(
  collection: ContentCollectionMeta,
): Record<string, unknown> {
  return Object.fromEntries(
    collection.fields.map((field) => [field.name, defaultValue(field)]),
  );
}

function fieldValueAsText(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n');
  return value === undefined || value === null ? '' : String(value);
}

function coerceFieldValue(
  field: ContentFieldDefinition,
  value: string | boolean,
): unknown {
  if (field.type === 'boolean') return value === true;
  if (field.type === 'integer') return value === '' ? undefined : Number(value);
  if (field.type === 'string-list') {
    return String(value)
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return String(value);
}

function routeFor(collection: ContentCollectionMeta, id: string): string {
  return collection.routePattern.replace(':id', id);
}

function draftBadge(draft: ContentDraft | undefined): string {
  if (!draft) return '';
  return draft.isNew ? 'new' : 'draft';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function countWords(value: string): number {
  const matches = value.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ContentWorkspace({
  onContentChanged,
  fullWidth = false,
}: ContentWorkspaceProps) {
  const [collections, setCollections] = useState<ContentCollectionMeta[]>([]);
  const [provider, setProvider] = useState<ProviderState>('local');
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [entries, setEntries] = useState<ContentEntryListItem[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [surfaces, setSurfaces] = useState<ContentSurface[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [mode, setMode] = useState<EditorMode>('empty');
  const [selectedId, setSelectedId] = useState('');
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState('');
  const [sourceRevision, setSourceRevision] = useState<string | undefined>();
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishJob, setPublishJob] = useState<PublishJob | null>(null);
  const [layout, setLayout] = useState<StudioLayout>(DEFAULT_LAYOUT);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const { confirm, dialog } = useDialogConfirm();

  // Read after mount so the server-rendered markup matches the first client
  // paint; localStorage is not available during SSR.
  useEffect(() => {
    setLayout(readLayout());
  }, []);

  // Debounced: a drag updates `layout` on every pointermove.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      } catch {
        // Private browsing or a full quota — the layout just won't persist.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [layout]);

  const selectedCollection = useMemo(
    () =>
      collections.find(
        (collection) => collection.id === selectedCollectionId,
      ) ?? null,
    [collections, selectedCollectionId],
  );

  const draftsById = useMemo(
    () => new Map(drafts.map((draft) => [draft.id, draft])),
    [drafts],
  );

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const draftOnly = drafts
      .filter((draft) => !entries.some((entry) => entry.id === draft.id))
      .map((draft) => ({
        id: draft.id,
        title: draft.title,
        path: draft.sourcePath,
        meta: {},
      }));
    const combined = [...entries, ...draftOnly];

    if (!normalized) return combined;
    return combined.filter(
      (entry) =>
        entry.title.toLowerCase().includes(normalized) ||
        entry.id.includes(normalized),
    );
  }, [drafts, entries, query]);

  const currentId = mode === 'new' ? slug : selectedId;
  const currentDraft = currentId ? draftsById.get(currentId) : undefined;
  const currentTitle = String(
    fields.title ?? currentDraft?.title ?? 'Untitled',
  );
  const hasBody = selectedCollection?.body ?? false;
  const previewUrl =
    selectedCollection && currentId
      ? `/api/admin/content/preview?collection=${encodeURIComponent(
          selectedCollection.id,
        )}&id=${encodeURIComponent(currentId)}`
      : '';

  const bodyHtml = useMemo(
    () => (hasBody ? (marked.parse(body, { async: false }) as string) : ''),
    [body, hasBody],
  );
  const wordCount = useMemo(() => countWords(body), [body]);

  // Books have no body, so Split/Preview would render an empty pane.
  const view: ViewMode = hasBody ? layout.view : 'preview';

  function resizePane(pane: Pane, width: number) {
    const bounds = PANE_BOUNDS[pane];
    setLayout((current) => ({
      ...current,
      [pane]: clamp(width, bounds.min, bounds.max),
    }));
  }

  function startResize(pane: Pane, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = layout[pane];
    handle.setPointerCapture(pointerId);

    const onMove = (move: globalThis.PointerEvent) => {
      // The inspector is anchored to the right edge, so it grows as the
      // pointer moves left.
      const delta =
        pane === 'library' ? move.clientX - startX : startX - move.clientX;
      resizePane(pane, startWidth + delta);
    };
    const onUp = () => {
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function nudgeResize(pane: Pane, event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    const towardsCanvas = pane === 'library' ? 1 : -1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resizePane(pane, layout[pane] - step * towardsCanvas);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      resizePane(pane, layout[pane] + step * towardsCanvas);
    }
  }

  async function refreshCollections() {
    const response = await fetchContentCollections();
    setCollections(response.collections);
    setProvider(response.provider);
    setSelectedCollectionId(
      (current) => current || response.collections[0]?.id || '',
    );
  }

  async function refreshEntries(collectionId = selectedCollectionId) {
    if (!collectionId) return;
    const response = await fetchContentEntries(collectionId);
    setEntries(response.entries);
    setDrafts(response.drafts ?? []);
  }

  async function refreshSurfaces(collection: ContentCollectionMeta | null) {
    if (!collection) return;
    const response = await fetchContentSurfaces(collection.indexRoute);
    setSurfaces(response.surfaces);
  }

  async function refreshMedia() {
    const response = await fetchContentMedia();
    setMedia(response.media);
  }

  useEffect(() => {
    let active = true;
    void fetchContentCollections()
      .then((response) => {
        if (!active) return;
        setCollections(response.collections);
        setProvider(response.provider);
        setSelectedCollectionId(response.collections[0]?.id ?? '');
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        const code = (caught as Error & { code?: string }).code;
        if (code === 'content_editing_unavailable') {
          setProvider('unavailable');
          setCollections([]);
          setError(null);
        } else {
          setError(
            caught instanceof Error ? caught.message : 'Could not load Studio.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedCollectionId) return;
    const collection =
      collections.find((item) => item.id === selectedCollectionId) ?? null;
    let active = true;
    setBusyKey('entries');
    void Promise.all([
      fetchContentEntries(selectedCollectionId),
      collection ? fetchContentSurfaces(collection.indexRoute) : null,
      fetchContentMedia().catch(() => ({ media: [] })),
    ])
      .then(([entryResponse, surfaceResponse, mediaResponse]) => {
        if (!active) return;
        setEntries(entryResponse.entries);
        setDrafts(entryResponse.drafts ?? []);
        setSurfaces(surfaceResponse?.surfaces ?? []);
        setMedia(mediaResponse.media);
        setMode('empty');
        setSelectedId('');
        setSlug('');
        setFields({});
        setBody('');
        setRevisions([]);
        setPublishJob(null);
        setDirty(false);
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : 'Could not load entries.',
        );
      })
      .finally(() => {
        if (active) setBusyKey(null);
      });

    return () => {
      active = false;
    };
  }, [collections, selectedCollectionId]);

  function startNewEntry(templateId?: string) {
    if (!selectedCollection) return;
    const template =
      selectedCollection.templates.find((item) => item.id === templateId) ??
      selectedCollection.templates[0];
    const nextFields = {
      ...defaultFields(selectedCollection),
      ...(template?.fields ?? {}),
    };
    setMode('new');
    setSelectedId('');
    setSlug(slugify(String(nextFields.title ?? '')));
    setFields(nextFields);
    setBody(blocksToMarkdown(template?.blocks ?? []));
    setSourceRevision(undefined);
    setIsNew(true);
    setRevisions([]);
    setPublishJob(null);
    setDirty(false);
    setNotice(null);
  }

  async function editEntry(entry: ContentEntryListItem) {
    if (!selectedCollection) return;
    setBusyKey(`entry-${entry.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchContentDraft(selectedCollection.id, entry.id);
      const source = response.source;
      const draft = response.draft;

      setMode('edit');
      setSelectedId(entry.id);
      setSlug(entry.id);
      setFields({
        ...defaultFields(selectedCollection),
        ...(draft?.fields ?? source?.fields ?? {}),
      });
      setBody(draft?.body ?? source?.body ?? '');
      setSourceRevision(draft?.sourceRevision ?? source?.revision);
      setIsNew(draft?.isNew ?? !source);
      setPublishJob(null);
      setDirty(false);
      const history = await fetchContentHistory(
        selectedCollection.id,
        entry.id,
      );
      setRevisions(history.revisions);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not open entry.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function persistDraft(): Promise<ContentDraft | null> {
    if (!selectedCollection) return null;
    const id = slugify(currentId || String(fields.title ?? ''));
    if (!id) {
      setError('Add a title or slug before saving a draft.');
      return null;
    }

    setBusyKey('save-draft');
    setError(null);
    setNotice(null);
    try {
      const response = await saveContentDraft(selectedCollection.id, id, {
        fields,
        body,
        sourceRevision,
        isNew,
      });
      setMode('edit');
      setSelectedId(response.draft.id);
      setSlug(response.draft.id);
      setSourceRevision(response.draft.sourceRevision);
      setIsNew(response.draft.isNew);
      setDirty(false);
      setNotice('Draft saved.');
      await Promise.all([
        refreshCollections(),
        refreshEntries(selectedCollection.id),
        refreshSurfaces(selectedCollection),
        onContentChanged?.(),
      ]);
      return response.draft;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save draft.',
      );
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  async function discardDraft() {
    if (!selectedCollection || !currentId) return;
    const ok = await confirm({
      title: 'Discard draft',
      message: 'Unsaved and saved draft changes will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    setBusyKey('discard-draft');
    setError(null);
    setNotice(null);
    try {
      await deleteContentDraft(selectedCollection.id, currentId);
      setNotice('Draft discarded.');
      await refreshEntries(selectedCollection.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not discard draft.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function publishDraft(deploy: boolean) {
    if (!selectedCollection) return;
    const draft = await persistDraft();
    if (!draft) return;

    setBusyKey(deploy ? 'publish-deploy' : 'publish');
    setError(null);
    setNotice(null);
    try {
      const response = await publishContentDraft({
        collection: selectedCollection.id,
        id: draft.id,
        runChecks: deploy,
        commit: deploy,
        push: deploy,
        deploy,
      });
      setPublishJob(response.job);
      setNotice(deploy ? 'Published and deployed.' : 'Published locally.');
      await Promise.all([
        refreshCollections(),
        refreshEntries(selectedCollection.id),
        refreshSurfaces(selectedCollection),
        onContentChanged?.(),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not publish draft.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function restoreRevision(hash: string) {
    if (!selectedCollection || !currentId) return;
    setBusyKey(`restore-${hash}`);
    setError(null);
    setNotice(null);
    try {
      const response = await restoreContentRevision(
        selectedCollection.id,
        currentId,
        hash,
      );
      setFields({
        ...defaultFields(selectedCollection),
        ...response.draft.fields,
      });
      setBody(response.draft.body ?? '');
      setSourceRevision(response.draft.sourceRevision);
      setIsNew(false);
      setDirty(false);
      setNotice('Revision restored as a draft.');
      await refreshEntries(selectedCollection.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not restore revision.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  /** Replace the selection (or insert at the caret) and restore the caret. */
  function insertAtCursor(snippet: string) {
    const editor = editorRef.current;
    if (!editor) {
      setBody((current) => (current ? `${current}\n\n${snippet}` : snippet));
      setDirty(true);
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    setBody(
      (current) => current.slice(0, start) + snippet + current.slice(end),
    );
    setDirty(true);
    requestAnimationFrame(() => {
      editor.focus();
      const caret = start + snippet.length;
      editor.setSelectionRange(caret, caret);
    });
  }

  async function uploadImage(
    file: File,
    target: { fieldName?: string; intoBody?: boolean },
  ) {
    if (!selectedCollection) return;
    const entryId = slugify(currentId || String(fields.title ?? 'uploads'));
    setBusyKey(`upload-${target.fieldName ?? 'body'}`);
    setError(null);
    try {
      const response = await uploadContentMedia(
        selectedCollection.id,
        entryId || 'uploads',
        file,
      );
      if (target.fieldName) {
        setFields((current) => ({
          ...current,
          [target.fieldName!]: response.media.url,
        }));
        setDirty(true);
      }
      if (target.intoBody) {
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '');
        insertAtCursor(`![${alt}](${response.media.url})`);
      }
      setNotice('Image uploaded.');
      await refreshMedia();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not upload image.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function removeMedia(asset: MediaAsset) {
    const ok = await confirm({
      title: 'Delete media',
      message: `Delete ${asset.name}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusyKey(`media-${asset.url}`);
    setError(null);
    try {
      await deleteContentMedia(asset.url);
      await refreshMedia();
      setNotice('Media deleted.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete media.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  function updateField(field: ContentFieldDefinition, value: string | boolean) {
    setFields((current) => ({
      ...current,
      [field.name]: coerceFieldValue(field, value),
    }));
    setDirty(true);
    if (field.name === 'title' && mode === 'new') {
      setSlug(slugify(String(value)));
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (busyKey !== 'save-draft') void persistDraft();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      insertAtCursor('  ');
    }
  }

  if (provider === 'unavailable' && !loading && !error) {
    return (
      <article
        id="content"
        className="admin-card admin-panel content-workspace"
      >
        <div className="admin-section-head">
          <div>
            <p className="admin-kicker">studio</p>
            <h2>Oddava Studio</h2>
          </div>
        </div>
        <div className="admin-empty-state" role="status">
          <p className="admin-muted">
            Content editing is only available in local development. Run{' '}
            <code>pnpm run dev</code> with <code>CONTENT_WRITE_MODE=local</code>
            .
          </p>
        </div>
      </article>
    );
  }

  return (
    <article
      id="content"
      className={`admin-card admin-panel content-workspace studio ${
        fullWidth ? 'studio--full' : ''
      }`}
    >
      {(error || notice) && (
        <div className="studio-alerts">
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="admin-success" role="status">
              {notice}
            </p>
          )}
        </div>
      )}

      <div
        className="studio-grid"
        style={
          {
            '--studio-library-w': `${layout.library}px`,
            '--studio-inspector-w': `${layout.inspector}px`,
          } as CSSProperties
        }
      >
        <section className="studio-library" aria-label="Content library">
          <div
            className="content-tabs"
            role="tablist"
            aria-label="Content collections"
          >
            {collections.map((collection) => (
              <button
                type="button"
                role="tab"
                aria-selected={collection.id === selectedCollectionId}
                className={`content-tab ${
                  collection.id === selectedCollectionId ? 'is-active' : ''
                }`}
                key={collection.id}
                onClick={() => setSelectedCollectionId(collection.id)}
              >
                <span>{collection.label}</span>
                {(collection.drafts ?? 0) > 0 && (
                  <span className="pill good">{collection.drafts}</span>
                )}
              </button>
            ))}
          </div>

          <div className="studio-library__search">
            <input
              className="admin-input"
              type="search"
              placeholder="Search"
              aria-label="Search content"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {selectedCollection && selectedCollection.templates.length > 0 && (
              <button
                type="button"
                className="studio-icon-button"
                title={`New ${selectedCollection.singularLabel}`}
                aria-label={`New ${selectedCollection.singularLabel}`}
                onClick={() => startNewEntry()}
              >
                <PlusIcon />
              </button>
            )}
          </div>

          <div className="studio-entry-list">
            {loading || busyKey === 'entries' ? (
              <p className="admin-empty" role="status">
                Loading content...
              </p>
            ) : filteredEntries.length === 0 ? (
              <p className="admin-empty">No entries yet.</p>
            ) : (
              filteredEntries.map((entry) => {
                const draft = draftsById.get(entry.id);
                return (
                  <button
                    type="button"
                    className={`studio-entry ${
                      currentId === entry.id ? 'is-active' : ''
                    }`}
                    key={entry.id}
                    onClick={() => void editEntry(entry)}
                    disabled={busyKey === `entry-${entry.id}`}
                  >
                    <strong>{entry.title}</strong>
                    <span>{entry.id}</span>
                    {draft && <em>{draftBadge(draft)}</em>}
                  </button>
                );
              })
            )}
          </div>

          {surfaces.length > 0 && (
            <div className="studio-surfaces">
              <h3>Editable pages</h3>
              {surfaces.map((surface) => (
                <button
                  type="button"
                  className="studio-surface"
                  key={surface.id}
                  onClick={() =>
                    void editEntry({
                      id: surface.entryId,
                      title: surface.label,
                      path: '',
                      meta: {},
                    })
                  }
                >
                  <span>{surface.label}</span>
                  <code>{surface.routePath}</code>
                </button>
              ))}
            </div>
          )}

          <div
            className="studio-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize library"
            aria-valuenow={layout.library}
            aria-valuemin={PANE_BOUNDS.library.min}
            aria-valuemax={PANE_BOUNDS.library.max}
            tabIndex={0}
            onPointerDown={(event) => startResize('library', event)}
            onKeyDown={(event) => nudgeResize('library', event)}
          />
        </section>

        <section className="studio-editor" aria-label="Editor">
          {mode === 'empty' || !selectedCollection ? (
            <div className="admin-empty-state">
              <p className="admin-empty">
                Pick an entry, or press + to start a new one.
              </p>
            </div>
          ) : (
            <>
              <div className="studio-editor-toolbar">
                <span className="pill">
                  {isNew ? 'new' : currentDraft ? 'draft' : 'published'}
                </span>
                <code>{routeFor(selectedCollection, currentId || 'new')}</code>

                <div className="studio-editor-toolbar__end">
                  {hasBody && (
                    <div
                      className="studio-view-switch"
                      role="group"
                      aria-label="Editor view"
                    >
                      {VIEW_MODES.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={view === item.id ? 'is-active' : ''}
                          aria-pressed={view === item.id}
                          onClick={() =>
                            setLayout((current) => ({
                              ...current,
                              view: item.id,
                            }))
                          }
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {previewUrl && (
                    <a
                      className="admin-button admin-button--ghost"
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  )}
                </div>
              </div>

              <div className={`studio-panes is-${view}`}>
                {hasBody && view !== 'preview' && (
                  <div className="studio-write">
                    <textarea
                      ref={editorRef}
                      className="studio-textarea"
                      aria-label="Markdown body"
                      placeholder="Write in Markdown…"
                      value={body}
                      onKeyDown={onEditorKeyDown}
                      onChange={(event) => {
                        setBody(event.currentTarget.value);
                        setDirty(true);
                      }}
                    />
                    <div className="studio-editor-status">
                      <span>{wordCount} words</span>
                      <span>{dirty ? 'Unsaved changes' : 'Saved'}</span>
                    </div>
                  </div>
                )}

                {view !== 'write' && (
                  <div className="studio-preview">
                    <article className="studio-preview__page">
                      <h1>{currentTitle}</h1>
                      {'description' in fields &&
                        String(fields.description ?? '') && (
                          <p className="studio-preview__lede">
                            {String(fields.description)}
                          </p>
                        )}
                      {Boolean(fields.coverImage) && (
                        <img
                          className="studio-preview__cover"
                          src={String(fields.coverImage)}
                          alt={currentTitle}
                        />
                      )}
                      {hasBody &&
                        (body.trim() ? (
                          <div
                            className="studio-prose"
                            // Markdown authored by the signed-in admin, rendered
                            // for that same admin. No third-party input reaches it.
                            dangerouslySetInnerHTML={{ __html: bodyHtml }}
                          />
                        ) : (
                          <p className="admin-empty">Nothing written yet.</p>
                        ))}
                    </article>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="studio-inspector" aria-label="Content details">
          <div
            className="studio-resizer studio-resizer--start"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details"
            aria-valuenow={layout.inspector}
            aria-valuemin={PANE_BOUNDS.inspector.min}
            aria-valuemax={PANE_BOUNDS.inspector.max}
            tabIndex={0}
            onPointerDown={(event) => startResize('inspector', event)}
            onKeyDown={(event) => nudgeResize('inspector', event)}
          />
          {mode === 'empty' || !selectedCollection ? (
            <div className="admin-empty-state">
              <p className="admin-empty">
                Select an entry to edit its details.
              </p>
            </div>
          ) : (
            <>
              <div className="studio-inspector-scroll">
                <label className="content-field">
                  <span>Slug</span>
                  <input
                    className="admin-input"
                    value={currentId}
                    disabled={mode === 'edit' && !isNew}
                    onChange={(event) =>
                      setSlug(slugify(event.currentTarget.value))
                    }
                  />
                </label>

                {selectedCollection.fields
                  .filter((field) => !field.hidden)
                  .map((field) => (
                    <label className="content-field" key={field.name}>
                      <span>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </span>
                      {field.description && <small>{field.description}</small>}

                      {field.type === 'textarea' ||
                      field.type === 'string-list' ? (
                        <textarea
                          className="admin-input content-textarea"
                          rows={3}
                          value={fieldValueAsText(fields[field.name])}
                          onChange={(event) =>
                            updateField(field, event.currentTarget.value)
                          }
                        />
                      ) : field.type === 'boolean' ? (
                        <span className="admin-toggle content-toggle">
                          <input
                            type="checkbox"
                            checked={fields[field.name] === true}
                            onChange={(event) =>
                              updateField(field, event.currentTarget.checked)
                            }
                          />
                          <span className="admin-toggle__track">
                            <span className="admin-toggle__thumb" />
                          </span>
                        </span>
                      ) : (
                        <input
                          className="admin-input"
                          type={
                            field.type === 'date'
                              ? 'date'
                              : field.type === 'integer'
                                ? 'number'
                                : 'text'
                          }
                          value={fieldValueAsText(fields[field.name])}
                          onChange={(event) =>
                            updateField(field, event.currentTarget.value)
                          }
                        />
                      )}

                      {field.type === 'image' && (
                        <input
                          className="content-upload-input"
                          type="file"
                          accept="image/webp,image/jpeg,image/png,image/gif"
                          disabled={busyKey === `upload-${field.name}`}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) {
                              void uploadImage(file, { fieldName: field.name });
                            }
                          }}
                        />
                      )}
                    </label>
                  ))}

                <section className="studio-section">
                  <div className="studio-section__head">
                    <h3>Media</h3>
                    <button
                      type="button"
                      className="admin-button admin-button--ghost"
                      onClick={() => void refreshMedia()}
                    >
                      Refresh
                    </button>
                  </div>

                  {hasBody && (
                    <input
                      className="content-upload-input"
                      type="file"
                      accept="image/webp,image/jpeg,image/png,image/gif"
                      aria-label="Upload image into the body"
                      disabled={busyKey === 'upload-body'}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file) void uploadImage(file, { intoBody: true });
                      }}
                    />
                  )}

                  {media.length === 0 ? (
                    <p className="admin-empty">No media yet.</p>
                  ) : (
                    <div className="studio-media-grid">
                      {media.slice(0, 12).map((asset) => (
                        <figure className="studio-media-item" key={asset.url}>
                          <button
                            type="button"
                            title={
                              hasBody
                                ? `Insert ${asset.name}`
                                : String(asset.name)
                            }
                            disabled={!hasBody}
                            onClick={() =>
                              insertAtCursor(`![${asset.name}](${asset.url})`)
                            }
                          >
                            <img src={asset.url} alt="" loading="lazy" />
                          </button>
                          <figcaption>{readableBytes(asset.size)}</figcaption>
                          <button
                            type="button"
                            className="studio-media-item__delete"
                            aria-label={`Delete ${asset.name}`}
                            title={`Delete ${asset.name}`}
                            disabled={busyKey === `media-${asset.url}`}
                            onClick={() => void removeMedia(asset)}
                          >
                            ×
                          </button>
                        </figure>
                      ))}
                    </div>
                  )}
                </section>

                {revisions.length > 0 && (
                  <section className="studio-section">
                    <div className="studio-section__head">
                      <h3>History</h3>
                    </div>
                    {revisions.slice(0, 5).map((revision) => (
                      <div className="studio-revision" key={revision.hash}>
                        <div>
                          <strong>
                            {revision.subject || revision.shortHash}
                          </strong>
                          <span>
                            {revision.shortHash} ·{' '}
                            {formatDate(revision.authoredAt)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          disabled={busyKey === `restore-${revision.hash}`}
                          onClick={() => void restoreRevision(revision.hash)}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </section>
                )}

                {publishJob && (
                  <section className="studio-section">
                    <div className="studio-section__head">
                      <h3>Publish job</h3>
                      <span
                        className={`pill ${
                          publishJob.status === 'failed' ? 'bad' : 'good'
                        }`}
                      >
                        {publishJob.status}
                      </span>
                    </div>
                    {publishJob.steps.map((step) => (
                      <p className="studio-job-step" key={step.label}>
                        <strong>{step.label}</strong>
                        <span>{step.status}</span>
                      </p>
                    ))}
                  </section>
                )}
              </div>

              <div className="studio-publish-bar">
                <button
                  type="button"
                  className="admin-button"
                  disabled={busyKey === 'save-draft'}
                  onClick={() => void persistDraft()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="admin-button primary"
                  disabled={busyKey === 'publish'}
                  onClick={() => void publishDraft(false)}
                >
                  Publish
                </button>
                <button
                  type="button"
                  className="admin-button"
                  disabled={busyKey === 'publish-deploy'}
                  onClick={() => void publishDraft(true)}
                >
                  Deploy
                </button>
                {currentDraft && (
                  <button
                    type="button"
                    className="studio-icon-button studio-icon-button--danger"
                    aria-label="Discard draft"
                    title="Discard draft"
                    disabled={busyKey === 'discard-draft'}
                    onClick={() => void discardDraft()}
                  >
                    ×
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      {dialog}
    </article>
  );
}
