import { useEffect, useMemo, useState } from 'react';
import {
  createContentEntry,
  deleteContentEntry,
  fetchContentCollections,
  fetchContentEntries,
  fetchContentEntry,
  reorderContentEntries,
  updateContentEntry,
  uploadContentMedia,
} from './api';
import type {
  ContentCollectionMeta,
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFieldDefinition,
  ContentWriteResult,
} from './types';

interface ContentWorkspaceProps {
  onContentChanged?: () => Promise<void>;
}

type EditorMode = 'empty' | 'new' | 'edit';

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

function formatResult(result: ContentWriteResult): string {
  if (result.provider === 'github') {
    return result.commitUrl
      ? 'Saved to GitHub. Deploy is pending.'
      : 'Saved to GitHub. Deploy is pending.';
  }
  return 'Saved locally.';
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

function ResultLink({ result }: { result: ContentWriteResult | null }) {
  if (!result?.commitUrl) return null;
  return (
    <a href={result.commitUrl} target="_blank" rel="noreferrer">
      View commit
    </a>
  );
}

export function ContentWorkspace({ onContentChanged }: ContentWorkspaceProps) {
  const [collections, setCollections] = useState<ContentCollectionMeta[]>([]);
  const [provider, setProvider] = useState<'github' | 'local'>('github');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [entries, setEntries] = useState<ContentEntryListItem[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ContentEntryDetail | null>(
    null,
  );
  const [mode, setMode] = useState<EditorMode>('empty');
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ContentWriteResult | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const selectedCollection = useMemo(
    () =>
      collections.find(
        (collection) => collection.id === selectedCollectionId,
      ) ?? null,
    [collections, selectedCollectionId],
  );

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
        setError(
          caught instanceof Error ? caught.message : 'Could not load content.',
        );
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
    let active = true;
    setBusyKey('entries');
    void fetchContentEntries(selectedCollectionId)
      .then((response) => {
        if (!active) return;
        setEntries(response.entries);
        setMode('empty');
        setSelectedEntry(null);
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
  }, [selectedCollectionId]);

  function startNewEntry() {
    if (!selectedCollection) return;
    const nextFields = defaultFields(selectedCollection);
    setMode('new');
    setSelectedEntry(null);
    setSlug('');
    setFields(nextFields);
    setBody('');
    setNotice(null);
    setLastResult(null);
  }

  async function editEntry(entry: ContentEntryListItem) {
    if (!selectedCollection) return;
    setBusyKey(`entry-${entry.id}`);
    setError(null);
    try {
      const response = await fetchContentEntry(selectedCollection.id, entry.id);
      setSelectedEntry(response.entry);
      setFields({
        ...defaultFields(selectedCollection),
        ...response.entry.fields,
      });
      setBody(response.entry.body ?? '');
      setSlug(response.entry.id);
      setMode('edit');
      setNotice(null);
      setLastResult(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load entry.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function saveEntry() {
    if (!selectedCollection) return;
    const entrySlug =
      mode === 'new' ? slug || slugify(String(fields.title ?? '')) : slug;
    setBusyKey('save');
    setError(null);
    setNotice(null);
    try {
      const response =
        mode === 'new'
          ? await createContentEntry(selectedCollection.id, {
              slug: entrySlug,
              fields,
              body,
            })
          : await updateContentEntry(selectedCollection.id, entrySlug, {
              fields,
              body,
              revision: selectedEntry?.revision,
            });
      setSelectedEntry(response.entry);
      setSlug(response.entry?.id ?? entrySlug);
      setMode('edit');
      setNotice(formatResult(response.result));
      setLastResult(response.result);
      await Promise.all([
        refreshCollections(),
        refreshEntries(selectedCollection.id),
        onContentChanged?.(),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save entry.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function removeEntry(entry: ContentEntryListItem) {
    if (!selectedCollection) return;
    if (!window.confirm(`Delete ${entry.title}?`)) return;

    setBusyKey(`delete-${entry.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await deleteContentEntry(
        selectedCollection.id,
        entry.id,
      );
      setNotice(formatResult(response.result));
      setLastResult(response.result);
      if (selectedEntry?.id === entry.id) {
        setSelectedEntry(null);
        setMode('empty');
      }
      await Promise.all([
        refreshCollections(),
        refreshEntries(selectedCollection.id),
        onContentChanged?.(),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete entry.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function reorderEntries(fromId: string, toId: string) {
    if (!selectedCollection || !selectedCollection.reorderable) return;
    const fromIndex = entries.findIndex((entry) => entry.id === fromId);
    const toIndex = entries.findIndex((entry) => entry.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const next = [...entries];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setEntries(next);

    setReordering(true);
    setError(null);
    try {
      await reorderContentEntries(
        selectedCollection.id,
        next.map((entry) => entry.id),
      );
      await refreshEntries(selectedCollection.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not reorder entries.',
      );
      await refreshEntries(selectedCollection.id);
    } finally {
      setReordering(false);
      setDragId(null);
      setDragOverId(null);
    }
  }

  async function uploadImage(
    file: File,
    target: { fieldName?: string; appendToBody?: boolean },
  ) {
    if (!selectedCollection) return;
    const entrySlug = slug || slugify(String(fields.title ?? ''));
    setBusyKey(`upload-${target.fieldName ?? 'body'}`);
    setError(null);
    try {
      const response = await uploadContentMedia(
        selectedCollection.id,
        entrySlug,
        file,
      );
      if (target.fieldName) {
        setFields((current) => ({
          ...current,
          [target.fieldName!]: response.media.url,
        }));
      }
      if (target.appendToBody) {
        setBody(
          (current) => `${current.trimEnd()}\n\n![](${response.media.url})\n`,
        );
      }
      setNotice('Image uploaded.');
      setLastResult(response.result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not upload image.',
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
  }

  return (
    <article id="content" className="admin-card admin-panel content-workspace">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">content</p>
          <h2>Content</h2>
          <p className="admin-muted">
            {provider === 'github'
              ? 'Saves commit to GitHub and deploy from main.'
              : 'Saves directly to local content files.'}
          </p>
        </div>
        <button
          type="button"
          className="admin-button primary"
          onClick={startNewEntry}
          disabled={!selectedCollection}
        >
          New {selectedCollection?.singularLabel ?? 'Entry'}
        </button>
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status">
          {notice} <ResultLink result={lastResult} />
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
          </button>
        ))}
      </div>

      <div className="content-workspace__grid">
        <section className="content-entry-list" aria-label="Content entries">
          {loading || busyKey === 'entries' ? (
            <p className="admin-empty" role="status">
              Loading content...
            </p>
          ) : entries.length === 0 ? (
            <p className="admin-empty">No entries yet.</p>
          ) : (
            entries.map((entry) => {
              const draggable =
                selectedCollection?.reorderable === true && !reordering;
              return (
                <button
                  type="button"
                  className={`content-entry-button ${
                    selectedEntry?.id === entry.id ? 'is-active' : ''
                  } ${dragId === entry.id ? 'is-dragging' : ''} ${
                    dragOverId === entry.id ? 'is-drag-over' : ''
                  }`}
                  key={entry.id}
                  onClick={() => void editEntry(entry)}
                  disabled={busyKey === `entry-${entry.id}` || reordering}
                  draggable={draggable}
                  onDragStart={(event) => {
                    setDragId(entry.id);
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', entry.id);
                    }
                  }}
                  onDragOver={(event) => {
                    if (!draggable) return;
                    event.preventDefault();
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'move';
                    }
                    if (dragOverId !== entry.id) setDragOverId(entry.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragId && dragId !== entry.id) {
                      void reorderEntries(dragId, entry.id);
                    } else {
                      setDragId(null);
                      setDragOverId(null);
                    }
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                >
                  {selectedCollection?.reorderable && (
                    <span
                      className="content-drag-handle"
                      aria-hidden="true"
                      title="Drag to reorder"
                    >
                      ⣿
                    </span>
                  )}
                  <strong>{entry.title}</strong>
                  <span>{entry.id}</span>
                </button>
              );
            })
          )}
        </section>

        <section className="content-editor-panel" aria-label="Content editor">
          {mode === 'empty' || !selectedCollection ? (
            <div className="admin-empty-state">
              <p className="admin-empty">
                Select an entry or create a new one.
              </p>
            </div>
          ) : (
            <form
              className="content-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEntry();
              }}
            >
              {selectedCollection.fields
                .filter((field) => !field.hidden)
                .map((field) => (
                <label className="content-field" key={field.name}>
                  <span>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  {field.description && (
                    <small className="admin-muted">{field.description}</small>
                  )}
                  {field.type === 'textarea' || field.type === 'string-list' ? (
                    <textarea
                      className="admin-input content-textarea"
                      value={fieldValueAsText(fields[field.name])}
                      onChange={(event) =>
                        updateField(field, event.target.value)
                      }
                    />
                  ) : field.type === 'boolean' ? (
                    <label className="admin-toggle content-toggle">
                      <input
                        type="checkbox"
                        checked={fields[field.name] === true}
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

              {selectedCollection.body && (
                <label className="content-field">
                  <span>MDX body</span>
                  <textarea
                    className="admin-input content-body-editor"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <input
                    className="content-upload-input"
                    type="file"
                    accept="image/webp,image/jpeg,image/png,image/gif"
                    disabled={busyKey === 'upload-body'}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void uploadImage(file, { appendToBody: true });
                    }}
                  />
                </label>
              )}

              <div className="content-editor-actions">
                <button
                  type="submit"
                  className="admin-button primary"
                  disabled={busyKey === 'save'}
                >
                  {busyKey === 'save' ? 'Saving...' : 'Save'}
                </button>
                {mode === 'edit' && selectedEntry && (
                  <button
                    type="button"
                    className="admin-button admin-button--danger"
                    disabled={busyKey === `delete-${selectedEntry.id}`}
                    onClick={() => void removeEntry(selectedEntry)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </article>
  );
}
