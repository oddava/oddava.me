import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { uploadContentMedia } from './api';
import type { Project } from '../../lib/contracts';
import {
  DEFAULT_DISPLAY,
  displayOf,
  storedDisplay,
  type ProjectImageDisplay,
} from '../../lib/project-image';
import {
  ProjectImageDialog,
  type ProjectImageResult,
  type ProjectImageSource,
} from './ProjectImageDialog';
import { Icon } from './studioIcons';
import { errorMessage } from './toast';

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

interface ProjectSheetProps {
  /** `null` adds a new project. */
  project: Project | null;
  onSubmit: (project: Project, isNew: boolean) => Promise<void>;
  onDelete: (project: Project) => void;
  onClose: () => void;
}

/**
 * The editor, in a sheet from the right edge so the list stays in view behind
 * it. A modal `<dialog>` brings focus trapping, Escape and the inert page
 * for free.
 */
export function ProjectSheet({
  project,
  onSubmit,
  onDelete,
  onClose,
}: ProjectSheetProps) {
  const isNew = project === null;
  const initial = useMemo(
    () => (project ? toDraft(project) : emptyDraft()),
    [project],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [adjusting, setAdjusting] = useState<ProjectImageSource | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => {
      mounted.current = false;
      element?.close();
    };
  }, []);

  /** Unsaved edits ask once, in place, instead of vanishing on a stray Escape. */
  const requestClose = () => {
    if (saving || uploading) return;
    if (dirty && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };

  const patch = (next: Partial<Draft>) => {
    setConfirmingDiscard(false);
    setDraft((current) => ({ ...current, ...next }));
  };

  const update = (field: keyof Draft) => (event: Event) =>
    patch({ [field]: (event.currentTarget as HTMLInputElement).value });

  const submit = async (event: Event) => {
    event.preventDefault();
    if (saving || uploading) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toProject(draft), isNew);
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err, 'could not save the project.'));
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.current?.requestSubmit();
    }
  };

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
      patch({ imageDisplay: display });
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
      patch({ imageSrc: media.url, imageDisplay: display });
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err, 'could not upload the image.'));
      }
    } finally {
      if (mounted.current) {
        setUploading(false);
        setAdjusting(null);
      }
    }
  };

  const src = draft.imageSrc.trim();
  const display = draft.imageDisplay;

  return (
    <dialog
      ref={dialog}
      className="adm-sheet"
      aria-labelledby="adm-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        // A click on the dialog itself, not its content, is on the backdrop.
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <form
        ref={form}
        className="adm-sheet__form"
        onSubmit={submit}
        onKeyDown={onKeyDown}
      >
        <header className="adm-sheet__head">
          <h2 id="adm-sheet-title">
            {isNew ? 'new project' : draft.name || project?.name}
          </h2>
          <button
            type="button"
            className="adm-icon-button"
            aria-label="Close"
            onClick={requestClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="adm-sheet__body">
          <div className="adm-field adm-field--image">
            <span className="adm-field__label" id="adm-image-label">
              image
            </span>
            <div className="adm-image" aria-labelledby="adm-image-label">
              {src ? (
                <span className="adm-image__frame">
                  <img
                    src={src}
                    alt=""
                    style={
                      display.fit === 'contain'
                        ? { objectFit: 'contain' }
                        : {
                            objectPosition: `${display.x}% ${display.y}%`,
                            transform: `scale(${display.zoom})`,
                            transformOrigin: `${display.x}% ${display.y}%`,
                          }
                    }
                  />
                </span>
              ) : (
                <button
                  type="button"
                  className="adm-image__frame adm-image__frame--empty"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  <Icon name="upload" />
                  <span>{uploading ? 'uploading…' : 'upload an image'}</span>
                </button>
              )}
              {src && (
                <div className="adm-image__tools">
                  <button
                    type="button"
                    className="hair-control adm-act"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'uploading…' : 'replace'}
                  </button>
                  <button
                    type="button"
                    className="hair-control adm-act"
                    onClick={() => setAdjusting({ kind: 'src', src })}
                    disabled={uploading}
                  >
                    adjust
                  </button>
                  <button
                    type="button"
                    className="hair-control adm-act"
                    onClick={() =>
                      patch({
                        imageSrc: '',
                        imageAlt: '',
                        imageDisplay: { ...DEFAULT_DISPLAY },
                      })
                    }
                    disabled={uploading}
                  >
                    remove
                  </button>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={chooseImage}
                hidden
              />
            </div>
            {!src && (
              <input
                id="admin-project-image-src"
                className="adm-input adm-input--small"
                value={draft.imageSrc}
                onInput={update('imageSrc')}
                placeholder="or paste an image url"
                aria-label="Image url"
              />
            )}
          </div>

          {src && (
            <label className="adm-field">
              <span className="adm-field__label">image description</span>
              <input
                className="adm-input"
                value={draft.imageAlt}
                onInput={update('imageAlt')}
                maxLength={160}
                placeholder="what the image shows"
                required
              />
            </label>
          )}

          <div className="adm-field-row">
            <label className="adm-field">
              <span className="adm-field__label">name</span>
              <input
                className="adm-input"
                value={draft.name}
                onInput={update('name')}
                maxLength={60}
                required
                autoFocus={isNew}
              />
            </label>
            <label className="adm-field adm-field--narrow">
              <span className="adm-field__label">year</span>
              <input
                className="adm-input"
                value={draft.year}
                onInput={update('year')}
                placeholder="2026 or now"
                inputMode="numeric"
                required
              />
            </label>
          </div>

          <label className="adm-field">
            <span className="adm-field__label">description</span>
            <textarea
              className="adm-input"
              value={draft.description}
              onInput={update('description')}
              maxLength={240}
              rows={2}
              required
            />
          </label>

          <label className="adm-field">
            <span className="adm-field__label">stack</span>
            <input
              className="adm-input"
              value={draft.stack}
              onInput={update('stack')}
              placeholder="astro, redis, workers"
            />
          </label>

          <div className="adm-field-row">
            <label className="adm-field">
              <span className="adm-field__label">site</span>
              <input
                className="adm-input"
                type="url"
                value={draft.site}
                onInput={update('site')}
                placeholder="https://"
              />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">source</span>
              <input
                className="adm-input"
                type="url"
                value={draft.source}
                onInput={update('source')}
                placeholder="https://github.com/…"
              />
            </label>
          </div>

          <div className="adm-switches">
            <label className="adm-switch-field">
              <span>featured</span>
              <input
                type="checkbox"
                role="switch"
                className="adm-switch adm-switch--input"
                checked={draft.featured}
                onChange={(event) =>
                  patch({ featured: event.currentTarget.checked })
                }
              />
            </label>
            <label className="adm-switch-field">
              <span>shown on the page</span>
              <input
                type="checkbox"
                role="switch"
                className="adm-switch adm-switch--input"
                checked={!draft.hidden}
                onChange={(event) =>
                  patch({ hidden: !event.currentTarget.checked })
                }
              />
            </label>
          </div>
        </div>

        <footer className="adm-sheet__foot">
          {error && (
            <p className="adm-sheet__error" role="alert">
              {error}
            </p>
          )}
          {confirmingDiscard ? (
            <div className="adm-sheet__bar" role="group" aria-live="polite">
              <span className="adm-sheet__ask">discard your changes?</span>
              <button
                type="button"
                className="hair-control adm-act adm-sheet__act"
                onClick={() => setConfirmingDiscard(false)}
              >
                keep editing
              </button>
              <button
                type="button"
                className="hair-control adm-act adm-act--danger adm-sheet__act"
                onClick={onClose}
              >
                discard
              </button>
            </div>
          ) : (
            <div className="adm-sheet__bar">
              {!isNew && project && (
                <button
                  type="button"
                  className="hair-control adm-act adm-act--quiet-danger adm-sheet__act adm-sheet__delete"
                  disabled={saving}
                  onClick={() => onDelete(project)}
                >
                  delete
                </button>
              )}
              {/* Closing is the ×, Escape or the backdrop; the footer only
                  commits. With nothing to save, save is a quiet label —
                  it turns solid the moment there is something to commit. */}
              {isNew || dirty ? (
                <button
                  type="submit"
                  className="adm-button adm-button--solid"
                  disabled={saving || uploading}
                  title="Save (Ctrl+Enter)"
                >
                  {saving ? 'saving…' : isNew ? 'add project' : 'save'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="hair-control adm-act adm-sheet__act"
                  disabled
                >
                  save
                </button>
              )}
            </div>
          )}
        </footer>
      </form>

      {adjusting && (
        <ProjectImageDialog
          source={adjusting}
          initial={draft.imageDisplay}
          name={draft.name}
          busy={uploading}
          onApply={(result) => void applyImage(result)}
          onCancel={() => setAdjusting(null)}
        />
      )}
    </dialog>
  );
}
