import { useEffect, useMemo, useState } from 'react';
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
  ContentBlockType,
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

interface ContentWorkspaceProps {
  onContentChanged?: () => Promise<void>;
}

type EditorMode = 'empty' | 'new' | 'edit';
type ProviderState = 'local' | 'unavailable';

const BLOCK_TYPES: { type: ContentBlockType; label: string }[] = [
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'heading', label: 'Heading' },
  { type: 'image', label: 'Image' },
  { type: 'code', label: 'Code' },
  { type: 'callout', label: 'Callout' },
  { type: 'raw-mdx', label: 'Raw MDX' },
];

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

function blockId(): string {
  return crypto.randomUUID();
}

function emptyBlock(type: ContentBlockType): ContentBlock {
  if (type === 'heading') return { id: blockId(), type, level: 2, value: '' };
  if (type === 'image') return { id: blockId(), type, src: '', alt: '' };
  if (type === 'code') return { id: blockId(), type, language: '', value: '' };
  if (type === 'callout') {
    return { id: blockId(), type, title: 'Note', value: '' };
  }
  return { id: blockId(), type, value: '' };
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

function bodyToBlocks(body: string): ContentBlock[] {
  const chunks = body
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/);
  if (chunks.length === 1 && !chunks[0]) return [];

  return chunks.map((chunk) => {
    const value = chunk.trim();
    const heading = value.match(/^(#{1,3})\s+(.+)$/);
    const image = value.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    const code = value.match(/^```([a-z0-9_-]*)\n([\s\S]*?)\n```$/i);

    if (heading) {
      return {
        id: blockId(),
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        value: heading[2],
      };
    }
    if (image) {
      return { id: blockId(), type: 'image', alt: image[1], src: image[2] };
    }
    if (code) {
      return {
        id: blockId(),
        type: 'code',
        language: code[1],
        value: code[2],
      };
    }
    if (/^(import|export)\s/m.test(value) || /^\s*[<{]/m.test(value)) {
      return { id: blockId(), type: 'raw-mdx', value };
    }
    return { id: blockId(), type: 'paragraph', value };
  });
}

function routeFor(collection: ContentCollectionMeta, id: string): string {
  return collection.routePattern.replace(':id', id);
}

function draftBadge(draft: ContentDraft | undefined): string {
  if (!draft) return '';
  return draft.isNew ? 'new draft' : 'draft';
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

export function ContentWorkspace({ onContentChanged }: ContentWorkspaceProps) {
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
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [sourceRevision, setSourceRevision] = useState<string | undefined>();
  const [isNew, setIsNew] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState('title');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishJob, setPublishJob] = useState<PublishJob | null>(null);
  const { confirm, dialog } = useDialogConfirm();

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
  const previewUrl =
    selectedCollection && currentId
      ? `/api/admin/content/preview?collection=${encodeURIComponent(
          selectedCollection.id,
        )}&id=${encodeURIComponent(currentId)}`
      : '';

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
        setBlocks([]);
        setRevisions([]);
        setPublishJob(null);
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
    const nextSlug = slugify(String(nextFields.title ?? ''));
    setMode('new');
    setSelectedId('');
    setSlug(nextSlug);
    setFields(nextFields);
    setBlocks(
      template?.blocks?.map((block) => ({ ...block, id: blockId() })) ?? [],
    );
    setSourceRevision(undefined);
    setIsNew(true);
    setSelectedRegion('title');
    setRevisions([]);
    setPublishJob(null);
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
      const nextFields = {
        ...defaultFields(selectedCollection),
        ...(draft?.fields ?? source?.fields ?? {}),
      };
      const nextBlocks =
        draft?.blocks ??
        (selectedCollection.supportsBlocks
          ? bodyToBlocks(source?.body ?? '')
          : []);

      setMode('edit');
      setSelectedId(entry.id);
      setSlug(entry.id);
      setFields(nextFields);
      setBlocks(nextBlocks);
      setSourceRevision(draft?.sourceRevision ?? source?.revision);
      setIsNew(draft?.isNew ?? !source);
      setSelectedRegion('title');
      setPublishJob(null);
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
        blocks,
        sourceRevision,
        isNew,
      });
      setMode('edit');
      setSelectedId(response.draft.id);
      setSlug(response.draft.id);
      setSourceRevision(response.draft.sourceRevision);
      setIsNew(response.draft.isNew);
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
      setBlocks(response.draft.blocks);
      setSourceRevision(response.draft.sourceRevision);
      setIsNew(false);
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

  async function uploadImage(
    file: File,
    target: { fieldName?: string; block?: boolean },
  ) {
    if (!selectedCollection) return;
    const entryId = slugify(currentId || String(fields.title ?? 'uploads'));
    setBusyKey(`upload-${target.fieldName ?? 'block'}`);
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
      }
      if (target.block) {
        setBlocks((current) => [
          ...current,
          {
            ...emptyBlock('image'),
            src: response.media.url,
            alt: file.name.replace(/\.[a-z0-9]+$/i, ''),
          },
        ]);
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
    if (field.name === 'title' && mode === 'new') {
      setSlug(slugify(String(value)));
    }
  }

  function updateBlock(id: string, next: Partial<ContentBlock>) {
    setBlocks((current) =>
      current.map((block) => (block.id === id ? { ...block, ...next } : block)),
    );
  }

  function changeBlockType(id: string, type: ContentBlockType) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === id
          ? { ...emptyBlock(type), id, value: block.value ?? '' }
          : block,
      ),
    );
  }

  function moveBlock(id: string, direction: -1 | 1) {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [block] = next.splice(index, 1);
      next.splice(nextIndex, 0, block);
      return next;
    });
  }

  function insertMedia(asset: MediaAsset) {
    setBlocks((current) => [
      ...current,
      { ...emptyBlock('image'), src: asset.url, alt: asset.name },
    ]);
    setSelectedRegion('body');
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
            <p className="admin-muted">
              Content editing is only available in local development.
            </p>
          </div>
        </div>
        <div className="admin-empty-state" role="status">
          <p className="admin-muted">
            Run <code>pnpm run dev</code> with{' '}
            <code>CONTENT_WRITE_MODE=local</code>, then publish from Studio.
          </p>
        </div>
      </article>
    );
  }

  return (
    <article
      id="content"
      className="admin-card admin-panel content-workspace studio"
    >
      <div className="admin-section-head studio-header">
        <div>
          <p className="admin-kicker">studio</p>
          <h2>Oddava Studio</h2>
          <p className="admin-muted">
            Draft visually, preview the page, then publish back to MDX/YAML.
          </p>
        </div>
        <div className="studio-actions">
          {selectedCollection?.templates.map((template) => (
            <button
              type="button"
              className="admin-button"
              key={template.id}
              onClick={() => startNewEntry(template.id)}
            >
              New {selectedCollection.singularLabel}
            </button>
          ))}
        </div>
      </div>

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

      <div
        className="content-tabs"
        role="tablist"
        aria-label="Content collections"
      >
        {collections.map((collection) => (
          <button
            type="button"
            className={`content-tab ${
              collection.id === selectedCollectionId ? 'is-active' : ''
            }`}
            key={collection.id}
            onClick={() => setSelectedCollectionId(collection.id)}
          >
            <span>{collection.label}</span>
            <span className="pill">{collection.count}</span>
            {(collection.drafts ?? 0) > 0 && (
              <span className="pill good">{collection.drafts} drafts</span>
            )}
          </button>
        ))}
      </div>

      <div className="studio-grid">
        <section className="studio-library" aria-label="Content library">
          <div className="studio-panel-head">
            <h3>Library</h3>
            <input
              className="admin-input"
              placeholder="Search content"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
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

          <div className="studio-surfaces">
            <h3>Editable pages</h3>
            {surfaces.length === 0 ? (
              <p className="admin-empty">No editable surfaces found.</p>
            ) : (
              surfaces.map((surface) => (
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
              ))
            )}
          </div>
        </section>

        <section className="studio-canvas" aria-label="Site canvas">
          {mode === 'empty' || !selectedCollection ? (
            <div className="admin-empty-state">
              <p className="admin-empty">
                Pick an entry or create a new one to start editing.
              </p>
            </div>
          ) : (
            <>
              <div className="studio-canvas-toolbar">
                <span className="pill">
                  {isNew ? 'new draft' : currentDraft ? 'draft' : 'published'}
                </span>
                <code>{routeFor(selectedCollection, currentId || 'new')}</code>
                {previewUrl && (
                  <a
                    className="admin-button admin-button--ghost"
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview
                  </a>
                )}
              </div>

              <div className="studio-page-preview">
                <button
                  type="button"
                  className={`studio-edit-surface ${
                    selectedRegion === 'title' ? 'is-selected' : ''
                  }`}
                  onClick={() => setSelectedRegion('title')}
                >
                  <span>Title</span>
                  <h1>{currentTitle}</h1>
                </button>
                {'description' in fields && (
                  <button
                    type="button"
                    className={`studio-edit-surface ${
                      selectedRegion === 'description' ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedRegion('description')}
                  >
                    <span>Description</span>
                    <p>
                      {String(fields.description ?? '') ||
                        'No description yet.'}
                    </p>
                  </button>
                )}

                {selectedCollection.id === 'books' ? (
                  <button
                    type="button"
                    className={`studio-book-preview ${
                      selectedRegion === 'coverImage' ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedRegion('coverImage')}
                  >
                    {fields.coverImage ? (
                      <img src={String(fields.coverImage)} alt={currentTitle} />
                    ) : (
                      <span>No cover</span>
                    )}
                    <strong>{currentTitle}</strong>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`studio-edit-surface studio-body-surface ${
                      selectedRegion === 'body' ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedRegion('body')}
                  >
                    <span>Body</span>
                    {blocks.length === 0 ? (
                      <p>No blocks yet.</p>
                    ) : (
                      blocks.map((block) => (
                        <div className="studio-preview-block" key={block.id}>
                          {block.type === 'heading' && (
                            <h2>{block.value || 'Heading'}</h2>
                          )}
                          {block.type === 'image' && (
                            <>
                              {block.src ? (
                                <img src={block.src} alt={block.alt ?? ''} />
                              ) : (
                                <p>Image block</p>
                              )}
                            </>
                          )}
                          {block.type === 'code' && (
                            <pre>{block.value || 'Code block'}</pre>
                          )}
                          {block.type === 'callout' && (
                            <aside>
                              <strong>{block.title || 'Note'}</strong>
                              <p>{block.value}</p>
                            </aside>
                          )}
                          {block.type === 'raw-mdx' && (
                            <pre>{block.value || 'Raw MDX'}</pre>
                          )}
                          {block.type === 'paragraph' && (
                            <p>{block.value || 'Paragraph'}</p>
                          )}
                        </div>
                      ))
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="studio-inspector" aria-label="Content inspector">
          {mode === 'empty' || !selectedCollection ? (
            <div className="admin-empty-state">
              <p className="admin-empty">Inspector is ready.</p>
            </div>
          ) : (
            <>
              <div className="studio-panel-head">
                <div>
                  <h3>Inspector</h3>
                  <p className="admin-muted">{currentTitle}</p>
                </div>
                <span className="pill">{selectedRegion}</span>
              </div>

              <div className="studio-inspector-scroll">
                <label className="content-field">
                  <span>Slug</span>
                  <input
                    className="admin-input"
                    value={currentId}
                    disabled={mode === 'edit' && !isNew}
                    onChange={(event) => setSlug(slugify(event.target.value))}
                  />
                </label>

                {selectedCollection.fields
                  .filter((field) => !field.hidden)
                  .map((field) => (
                    <label
                      className={`content-field ${
                        selectedRegion === field.name ? 'is-selected' : ''
                      }`}
                      key={field.name}
                    >
                      <span>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </span>
                      {field.description && (
                        <small className="admin-muted">
                          {field.description}
                        </small>
                      )}
                      {field.type === 'textarea' ||
                      field.type === 'string-list' ? (
                        <textarea
                          className="admin-input content-textarea"
                          value={fieldValueAsText(fields[field.name])}
                          onFocus={() => setSelectedRegion(field.name)}
                          onChange={(event) =>
                            updateField(field, event.target.value)
                          }
                        />
                      ) : field.type === 'boolean' ? (
                        <label className="admin-toggle content-toggle">
                          <input
                            type="checkbox"
                            checked={fields[field.name] === true}
                            onFocus={() => setSelectedRegion(field.name)}
                            onChange={(event) =>
                              updateField(field, event.target.checked)
                            }
                          />
                          <span className="admin-toggle__track">
                            <span className="admin-toggle__thumb" />
                          </span>
                        </label>
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
                          onFocus={() => setSelectedRegion(field.name)}
                          onChange={(event) =>
                            updateField(field, event.target.value)
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

                {selectedCollection.supportsBlocks && (
                  <section className="studio-block-editor">
                    <div className="studio-panel-head">
                      <h3>Blocks</h3>
                      <div className="studio-block-actions">
                        {BLOCK_TYPES.slice(0, 4).map((block) => (
                          <button
                            type="button"
                            className="admin-button"
                            key={block.type}
                            onClick={() =>
                              setBlocks((current) => [
                                ...current,
                                emptyBlock(block.type),
                              ])
                            }
                          >
                            {block.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {blocks.map((block, index) => (
                      <div className="studio-block" key={block.id}>
                        <div className="studio-block__toolbar">
                          <select
                            className="admin-input"
                            value={block.type}
                            onChange={(event) =>
                              changeBlockType(
                                block.id,
                                event.target.value as ContentBlockType,
                              )
                            }
                          >
                            {BLOCK_TYPES.map((item) => (
                              <option value={item.type} key={item.type}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="admin-button admin-button--ghost"
                            onClick={() => moveBlock(block.id, -1)}
                            disabled={index === 0}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--ghost"
                            onClick={() => moveBlock(block.id, 1)}
                            disabled={index === blocks.length - 1}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--danger"
                            onClick={() =>
                              setBlocks((current) =>
                                current.filter((item) => item.id !== block.id),
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>

                        {block.type === 'heading' && (
                          <div className="studio-block__grid">
                            <input
                              className="admin-input"
                              type="number"
                              min="1"
                              max="3"
                              value={block.level ?? 2}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  level: Number(event.target.value) as
                                    1 | 2 | 3,
                                })
                              }
                            />
                            <input
                              className="admin-input"
                              value={block.value ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  value: event.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                        {block.type === 'image' && (
                          <div className="studio-block__grid">
                            <input
                              className="admin-input"
                              placeholder="Image URL"
                              value={block.src ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  src: event.target.value,
                                })
                              }
                            />
                            <input
                              className="admin-input"
                              placeholder="Alt text"
                              value={block.alt ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  alt: event.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                        {block.type === 'code' && (
                          <>
                            <input
                              className="admin-input"
                              placeholder="Language"
                              value={block.language ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  language: event.target.value,
                                })
                              }
                            />
                            <textarea
                              className="admin-input content-textarea"
                              value={block.value ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  value: event.target.value,
                                })
                              }
                            />
                          </>
                        )}
                        {block.type === 'callout' && (
                          <>
                            <input
                              className="admin-input"
                              placeholder="Title"
                              value={block.title ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  title: event.target.value,
                                })
                              }
                            />
                            <textarea
                              className="admin-input content-textarea"
                              value={block.value ?? ''}
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  value: event.target.value,
                                })
                              }
                            />
                          </>
                        )}
                        {(block.type === 'paragraph' ||
                          block.type === 'raw-mdx') && (
                          <textarea
                            className="admin-input content-textarea"
                            value={block.value ?? ''}
                            onChange={(event) =>
                              updateBlock(block.id, {
                                value: event.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                    <input
                      className="content-upload-input"
                      type="file"
                      accept="image/webp,image/jpeg,image/png,image/gif"
                      disabled={busyKey === 'upload-block'}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file) void uploadImage(file, { block: true });
                      }}
                    />
                  </section>
                )}

                <section className="studio-media">
                  <div className="studio-panel-head">
                    <h3>Media</h3>
                    <button
                      type="button"
                      className="admin-button admin-button--ghost"
                      onClick={() => void refreshMedia()}
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="studio-media-grid">
                    {media.slice(0, 12).map((asset) => (
                      <div className="studio-media-item" key={asset.url}>
                        <button
                          type="button"
                          onClick={() => insertMedia(asset)}
                          title={asset.url}
                        >
                          <img src={asset.url} alt="" loading="lazy" />
                        </button>
                        <span>{readableBytes(asset.size)}</span>
                        <button
                          type="button"
                          className="admin-button admin-button--ghost"
                          onClick={() => void removeMedia(asset)}
                          disabled={busyKey === `media-${asset.url}`}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {revisions.length > 0 && (
                  <section className="studio-history">
                    <h3>History</h3>
                    {revisions.slice(0, 5).map((revision) => (
                      <div className="studio-revision" key={revision.hash}>
                        <div>
                          <strong>
                            {revision.subject || revision.shortHash}
                          </strong>
                          <span>
                            {revision.shortHash} by {revision.author} on{' '}
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
                  <section className="studio-publish-job">
                    <h3>Publish job</h3>
                    <span
                      className={`pill ${publishJob.status === 'failed' ? 'bad' : 'good'}`}
                    >
                      {publishJob.status}
                    </span>
                    {publishJob.steps.map((step) => (
                      <p key={step.label}>
                        <strong>{step.label}</strong>: {step.status}
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
                  Save draft
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
                  className="admin-button primary"
                  disabled={busyKey === 'publish-deploy'}
                  onClick={() => void publishDraft(true)}
                >
                  Publish & deploy
                </button>
                {currentDraft && (
                  <button
                    type="button"
                    className="admin-button admin-button--danger"
                    disabled={busyKey === 'discard-draft'}
                    onClick={() => void discardDraft()}
                  >
                    Discard draft
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
