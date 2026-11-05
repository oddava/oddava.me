import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchProjects, saveProjects, uploadContentMedia } from './api';
import { SkeletonRow } from '../ui/Skeleton';
import type { Project } from '../../lib/contracts';
import { useDialogConfirm } from './useDialogConfirm';
import {
  ProjectImageDialog,
  type ProjectImageResult,
  type ProjectImageSource,
} from './ProjectImageDialog';
import {
  DEFAULT_DISPLAY,
  displayOf,
  storedDisplay,
  type ProjectImageDisplay,
} from '../../lib/project-image';
import './ProjectsPanel.css';

/** The form edits strings; `toProject` turns them back into a project. */
interface Draft {
  id: string;
  name: string;
  description: string;
  year: string;
  stack: string;
  site: string;
  source: string;
  imageSrc: string;
  imageAlt: string;
  imageDisplay: ProjectImageDisplay;
  featured: boolean;
  hidden: boolean;
}

/**
 * Project images go into the content media store, grouped under this folder:
 * served from `/images/notes/projects/…` and included in `notes:export`, so a
 * prune run from a fresh export keeps them.
 */
const MEDIA_COLLECTION = 'notes';
const MEDIA_FOLDER = 'projects';

interface Editing {
  draft: Draft;
  isNew: boolean;
}

function toDraft(project: Project): Draft {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    year: String(project.year),
    stack: project.stack.join(', '),
    site: project.site ?? '',
    source: project.source ?? '',
    imageSrc: project.image?.src ?? '',
    imageAlt: project.image?.alt ?? '',
    imageDisplay: displayOf(project.image),
    featured: project.featured === true,
    hidden: project.hidden,
  };
}

function emptyDraft(): Draft {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    year: String(new Date().getFullYear()),
    stack: '',
    site: '',
    source: '',
    imageSrc: '',
    imageAlt: '',
    imageDisplay: { ...DEFAULT_DISPLAY },
    featured: false,
    hidden: false,
  };
}

/** The server validates; this only reshapes, so its message is the one shown. */
function toProject(draft: Draft): Project {
  const year = draft.year.trim();
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    year: year === 'now' ? 'now' : Number(year),
    stack: draft.stack
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean),
    site: draft.site,
    source: draft.source,
    ...(draft.imageSrc.trim()
      ? {
          image: {
            src: draft.imageSrc,
            alt: draft.imageAlt,
            ...storedDisplay(draft.imageDisplay),
          },
        }
      : {}),
    ...(draft.featured ? { featured: true } : {}),
    hidden: draft.hidden,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adjusting, setAdjusting] = useState<ProjectImageSource | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useDialogConfirm();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      if (!mounted.current) return;
      setProjects(data.projects);
      setRevision(data.revision);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Could not load projects.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** Every change saves the whole list against the revision it was based on. */
  const commit = async (next: Project[], message: string) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const data = await saveProjects(next, revision);
      if (!mounted.current) return false;
      setProjects(data.projects);
      setRevision(data.revision);
      setNotice(message);
      return true;
    } catch (err) {
      if (!mounted.current) return false;
      setError(err instanceof Error ? err.message : 'Could not save projects.');
      if (errorCode(err) === 'conflict') await load();
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...projects];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    void commit(next, `${item.name} moved ${delta < 0 ? 'up' : 'down'}.`);
  };

  const toggleHidden = (project: Project) =>
    void commit(
      projects.map((item) =>
        item.id === project.id ? { ...item, hidden: !item.hidden } : item,
      ),
      `${project.name} ${project.hidden ? 'shown' : 'hidden'}.`,
    );

  const remove = async (project: Project) => {
    const ok = await confirm({
      title: 'Delete project',
      message: `Delete ${project.name}? Hiding it keeps it here instead.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (editing?.draft.id === project.id) setEditing(null);
    void commit(
      projects.filter((item) => item.id !== project.id),
      `${project.name} deleted.`,
    );
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!editing) return;
    const project = toProject(editing.draft);
    // New projects go to the top: the page reads newest first.
    const next = editing.isNew
      ? [project, ...projects]
      : projects.map((item) => (item.id === project.id ? project : item));
    const saved = await commit(
      next,
      `${project.name || 'Project'} ${editing.isNew ? 'added' : 'saved'}.`,
    );
    if (saved && mounted.current) setEditing(null);
  };

  const openEditor = (draft: Draft, isNew: boolean) => {
    setEditing({ draft, isNew });
    setError(null);
    setNotice(null);
  };

  const patchDraft = (patch: Partial<Draft>) =>
    setEditing((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );

  const update = (field: keyof Draft) => (event: Event) =>
    patchDraft({ [field]: (event.currentTarget as HTMLInputElement).value });

  /** A chosen file opens the image dialog first; nothing uploads until it says. */
  const chooseImage = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) setAdjusting({ kind: 'file', file });
  };

  /**
   * Uploads a new file (already sized by the dialog) to the media store and
   * fills `src`, or only takes the display settings. The save still decides.
   */
  const applyImage = async ({ file, display }: ProjectImageResult) => {
    if (!file) {
      patchDraft({ imageDisplay: display });
      setAdjusting(null);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { media } = await uploadContentMedia(
        MEDIA_COLLECTION,
        MEDIA_FOLDER,
        file,
      );
      if (!mounted.current) return;
      patchDraft({ imageSrc: media.url, imageDisplay: display });
      setAdjusting(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Could not upload image.');
      setAdjusting(null);
    } finally {
      if (mounted.current) setUploading(false);
    }
  };

  const editor = (draft: Draft, isNew: boolean) => (
    <form className="admin-project-form" onSubmit={submit}>
      <div className="admin-project-form__grid">
        <label className="admin-project-form__field">
          <span>Name</span>
          <input
            className="admin-input"
            value={draft.name}
            onInput={update('name')}
            maxLength={60}
            required
            autoFocus
          />
        </label>
        <label className="admin-project-form__field">
          <span>Year</span>
          <input
            className="admin-input"
            value={draft.year}
            onInput={update('year')}
            placeholder="2026 or now"
            inputMode="numeric"
            required
          />
        </label>
        <label className="admin-project-form__field admin-project-form__field--wide">
          <span>Description</span>
          <textarea
            className="admin-input"
            value={draft.description}
            onInput={update('description')}
            maxLength={240}
            rows={2}
            required
          />
        </label>
        <label className="admin-project-form__field admin-project-form__field--wide">
          <span>Stack</span>
          <input
            className="admin-input"
            value={draft.stack}
            onInput={update('stack')}
            placeholder="astro, redis, workers"
          />
        </label>
        <label className="admin-project-form__field">
          <span>Site</span>
          <input
            className="admin-input"
            type="url"
            value={draft.site}
            onInput={update('site')}
            placeholder="https://"
          />
        </label>
        <label className="admin-project-form__field">
          <span>Source</span>
          <input
            className="admin-input"
            type="url"
            value={draft.source}
            onInput={update('source')}
            placeholder="https://github.com/…"
          />
        </label>
        <div className="admin-project-form__field admin-project-form__field--wide">
          <label for="admin-project-image-src">Image</label>
          <div className="admin-project-form__image">
            {draft.imageSrc.trim() && (
              <span className="admin-project-form__preview">
                <img
                  src={draft.imageSrc}
                  alt=""
                  style={
                    draft.imageDisplay.fit === 'contain'
                      ? { objectFit: 'contain' }
                      : {
                          objectPosition: `${draft.imageDisplay.x}% ${draft.imageDisplay.y}%`,
                          transform: `scale(${draft.imageDisplay.zoom})`,
                          transformOrigin: `${draft.imageDisplay.x}% ${draft.imageDisplay.y}%`,
                        }
                  }
                />
              </span>
            )}
            <input
              id="admin-project-image-src"
              className="admin-input"
              value={draft.imageSrc}
              onInput={update('imageSrc')}
              placeholder="upload, or https://"
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={chooseImage}
              hidden
            />
            <button
              type="button"
              className="admin-button admin-button--ghost"
              onClick={() => fileInput.current?.click()}
              disabled={busy || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            {draft.imageSrc.trim() && (
              <button
                type="button"
                className="admin-button admin-button--ghost"
                onClick={() =>
                  setAdjusting({ kind: 'src', src: draft.imageSrc.trim() })
                }
                disabled={busy || uploading}
              >
                Adjust
              </button>
            )}
            {draft.imageSrc && (
              <button
                type="button"
                className="admin-button admin-button--ghost"
                onClick={() =>
                  patchDraft({
                    imageSrc: '',
                    imageAlt: '',
                    imageDisplay: { ...DEFAULT_DISPLAY },
                  })
                }
                disabled={busy || uploading}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <label className="admin-project-form__field admin-project-form__field--wide">
          <span>Image alt text</span>
          <input
            className="admin-input"
            value={draft.imageAlt}
            onInput={update('imageAlt')}
            maxLength={160}
            placeholder="what the image shows"
            required={Boolean(draft.imageSrc.trim())}
          />
        </label>
        <label className="admin-project-form__check">
          <input
            type="checkbox"
            checked={draft.featured}
            onChange={(event) =>
              patchDraft({ featured: event.currentTarget.checked })
            }
          />
          <span>Featured</span>
        </label>
      </div>
      <div className="admin-project-form__actions">
        <button
          type="button"
          className="admin-button admin-button--ghost"
          onClick={() => {
            setEditing(null);
            setError(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="admin-button primary"
          disabled={busy || uploading}
        >
          {busy ? 'Saving…' : isNew ? 'Add project' : 'Save'}
        </button>
      </div>
    </form>
  );

  return (
    <article id="projects" className="admin-card admin-panel admin-projects">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">site</p>
          <h2>Projects</h2>
        </div>
        <div className="admin-toolbar">
          <a
            className="admin-button admin-button--ghost"
            href="/projects"
            target="_blank"
            rel="noopener"
          >
            View page
          </a>
          <button
            type="button"
            className="admin-button primary"
            disabled={loading || busy || editing?.isNew === true}
            onClick={() => openEditor(emptyDraft(), true)}
          >
            Add project
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {editing?.isNew && editor(editing.draft, true)}

      <ol className="admin-project-list">
        {loading && projects.length === 0 && (
          <li role="status" aria-live="polite">
            <SkeletonRow />
            <SkeletonRow />
          </li>
        )}

        {!loading && projects.length === 0 && (
          <li className="admin-empty-state">
            <p className="admin-empty">No projects yet.</p>
          </li>
        )}

        {projects.map((project, index) =>
          editing && !editing.isNew && editing.draft.id === project.id ? (
            <li key={project.id}>{editor(editing.draft, false)}</li>
          ) : (
            <li
              key={project.id}
              className={`admin-project-row ${
                project.hidden ? 'admin-project-row--hidden' : ''
              }`}
            >
              <div className="admin-project-row__info">
                <div className="admin-project-row__heading">
                  <span className="admin-project-row__name">
                    {project.name}
                  </span>
                  <span className="admin-project-row__year">
                    {project.year}
                  </span>
                  {project.featured && <span className="pill">featured</span>}
                  {project.hidden && <span className="pill">hidden</span>}
                </div>
                <p className="admin-project-row__description">
                  {project.description}
                </p>
              </div>
              <div className="admin-project-row__actions">
                <button
                  type="button"
                  className="admin-button admin-button--ghost admin-project-row__step"
                  aria-label={`Move ${project.name} up`}
                  title="Move up"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--ghost admin-project-row__step"
                  aria-label={`Move ${project.name} down`}
                  title="Move down"
                  disabled={busy || index === projects.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--ghost"
                  disabled={busy}
                  onClick={() => openEditor(toDraft(project), false)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--ghost admin-project-row__visibility"
                  disabled={busy}
                  onClick={() => toggleHidden(project)}
                >
                  {project.hidden ? 'Show' : 'Hide'}
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--danger"
                  disabled={busy}
                  onClick={() => void remove(project)}
                >
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ol>

      {dialog}
      {adjusting && editing && (
        <ProjectImageDialog
          source={adjusting}
          initial={editing.draft.imageDisplay}
          name={editing.draft.name}
          busy={uploading}
          onApply={(result) => void applyImage(result)}
          onCancel={() => setAdjusting(null)}
        />
      )}
    </article>
  );
}
