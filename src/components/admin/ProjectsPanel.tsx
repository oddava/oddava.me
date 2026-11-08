import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import { fetchProjects, saveProjects } from './api';
import { SkeletonRow } from '../ui/Skeleton';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { Project } from '../../lib/contracts';
import { displayOf } from '../../lib/project-image';
import { Icon } from './studioIcons';
import { ProjectSheet } from './ProjectSheet';
import { errorMessage, useToast } from './toast';
import './ProjectsPanel.css';

interface Editing {
  project: Project | null;
}

/** A queued save dropped because one before it failed and the list reloaded. */
class Superseded extends Error {}

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The thumbnail frames the image the way the public card does. */
function Thumb({ project }: { project: Project }) {
  if (!project.image) {
    return <span className="adm-project__thumb" aria-hidden="true" />;
  }
  const display = displayOf(project.image);
  return (
    <span className="adm-project__thumb" aria-hidden="true">
      <img
        src={project.image.src}
        alt=""
        loading="lazy"
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
  );
}

export function ProjectsPanel() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  /** What the list shows: every change applied, saved or not yet. */
  const shown = useRef<Project[]>([]);
  /** What the server last confirmed, and the revision the next save names. */
  const saved = useRef({ projects: [] as Project[], revision: 0 });
  /**
   * Saves run one at a time, each against the revision the one before it
   * returned — so quick moves never race each other into a conflict.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Bumped on a failed save; saves queued behind it are dropped. */
  const generation = useRef(0);
  /** The grip to refocus once a keyboard move re-renders the list. */
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = (next: Project[]) => {
    shown.current = next;
    if (mounted.current) setProjects(next);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      if (!mounted.current) return;
      saved.current = { projects: data.projects, revision: data.revision };
      show(data.projects);
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(errorMessage(err, 'could not load projects.'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!refocus.current) return;
    list.current
      ?.querySelector<HTMLElement>(
        `[data-grip="${CSS.escape(refocus.current)}"]`,
      )
      ?.focus();
    refocus.current = null;
  });

  /**
   * Shows `next` at once and queues a save of the whole list. A failure —
   * a stale tab's conflict included — reloads the server's copy instead of
   * overwriting it. Rejects, so a caller with its own error surface (the
   * sheet) can show the message.
   */
  const save = (next: Project[]) => {
    show(next);
    const ticket = generation.current;
    const run = queue.current.then(async () => {
      if (ticket !== generation.current) throw new Superseded();
      const data = await saveProjects(next, saved.current.revision);
      saved.current = { projects: data.projects, revision: data.revision };
    });
    queue.current = run.catch(() => {});
    return run.then(
      () => {
        // Adopt the server's copy unless a newer change is already showing.
        if (shown.current === next) show(saved.current.projects);
      },
      async (err) => {
        if (!(err instanceof Superseded)) {
          generation.current += 1;
          await load();
        }
        throw err;
      },
    );
  };

  const report = (err: unknown, fallback: string) => {
    if (err instanceof Superseded) return;
    toast.show({ message: errorMessage(err, fallback), tone: 'error' });
  };

  /** For list actions: the result is a message, with undo where it can. */
  const commit = (next: Project[], message: string, undo: () => Project[]) =>
    save(next).then(
      () =>
        toast.show({
          message,
          undo: () =>
            save(undo()).catch((err) => report(err, 'could not undo.')),
        }),
      (err) => report(err, 'could not save projects.'),
    );

  const move = (from: number, to: number) => {
    const current = shown.current;
    if (to < 0 || to >= current.length || to === from) return;
    const item = current[from];
    // The row moving is the feedback; a message per arrow press would be
    // noise. Screen readers hear the new position.
    setAnnouncement(`${item.name}, position ${to + 1} of ${current.length}.`);
    save(moved(current, from, to)).catch((err) =>
      report(err, 'could not reorder projects.'),
    );
  };

  const toggleHidden = (project: Project) => {
    const flip = (hidden: boolean) =>
      shown.current.map((item) =>
        item.id === project.id ? { ...item, hidden } : item,
      );
    void commit(
      flip(!project.hidden),
      `${project.name} ${project.hidden ? 'shown on the page' : 'hidden from the page'}.`,
      () => flip(project.hidden),
    );
  };

  const remove = (project: Project) => {
    const index = shown.current.findIndex((item) => item.id === project.id);
    setEditing(null);
    // The row that had focus is gone; the section heading takes it.
    window.requestAnimationFrame(() => heading.current?.focus());
    void commit(
      shown.current.filter((item) => item.id !== project.id),
      `${project.name} deleted.`,
      () => {
        const restored = [...shown.current];
        restored.splice(Math.min(index, restored.length), 0, project);
        return restored;
      },
    );
  };

  /** Called by the sheet; a rejection keeps the sheet open with the message. */
  const submit = async (project: Project, isNew: boolean) => {
    const current = shown.current;
    if (!isNew && !current.some((item) => item.id === project.id)) {
      throw new Error(
        'this project was deleted elsewhere; close to see the list.',
      );
    }
    // New projects go to the top: the page reads newest first.
    await save(
      isNew
        ? [project, ...current]
        : current.map((item) => (item.id === project.id ? project : item)),
    );
    toast.show({ message: `${project.name} ${isNew ? 'added' : 'saved'}.` });
    setEditing(null);
  };

  // --- Reordering -------------------------------------------------------

  const onGripKey = (
    event: TargetedKeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    // Read the position from the list as it stands, not as this render saw
    // it: held-down arrows fire faster than the list re-renders.
    const index = shown.current.findIndex((item) => item.id === id);
    const last = shown.current.length - 1;
    const to =
      event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'ArrowDown'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null || index < 0) return;
    event.preventDefault();
    refocus.current = id;
    move(index, to);
  };

  /**
   * Pointer drag on the grip: the held row follows the pointer, the rows it
   * passes slide out of its way, and the list saves once, on release.
   */
  const onGripDown = (
    event: TargetedPointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (event.button !== 0 || !list.current) return;
    const from = shown.current.findIndex((item) => item.id === id);
    if (from < 0) return;
    event.preventDefault();
    const rows = Array.from(
      list.current.querySelectorAll<HTMLElement>('[data-row]'),
    );
    const rects = rows.map((row) => row.getBoundingClientRect());
    const held = rows[from];
    const step = rects[from].height;
    const startY = event.clientY;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let over = from;
    setHeldId(id);

    const onMove = (moveEvent: PointerEvent) => {
      const dy = moveEvent.clientY - startY;
      const centre = rects[from].top + rects[from].height / 2 + dy;
      over = from;
      for (let i = from + 1; i < rects.length; i++) {
        if (centre > rects[i].top + rects[i].height / 2) over = i;
      }
      for (let i = from - 1; i >= 0; i--) {
        if (centre < rects[i].top + rects[i].height / 2) over = i;
      }
      held.style.transform = `translateY(${dy}px)`;
      rows.forEach((row, i) => {
        if (i === from) return;
        const shift =
          from < over && i > from && i <= over
            ? -step
            : from > over && i < from && i >= over
              ? step
              : 0;
        row.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      rows.forEach((row) => {
        row.style.transform = '';
      });
      setHeldId(null);
      if (over !== from) move(from, over);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  return (
    <section
      id="projects"
      className="adm-section"
      aria-labelledby="projects-title"
    >
      <header className="adm-head">
        <h2
          id="projects-title"
          ref={heading}
          className="adm-head__title"
          tabIndex={-1}
        >
          projects
        </h2>
        <div className="adm-head__tools">
          <a
            className="hair-control adm-tab"
            href="/projects"
            target="_blank"
            rel="noopener"
          >
            view page
            <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
          </a>
          <button
            type="button"
            className="hair-control adm-tab adm-tab--go"
            disabled={loading && projects.length === 0}
            onClick={() => setEditing({ project: null })}
          >
            <Icon name="plus" />
            new project
          </button>
        </div>
      </header>

      <p id="projects-reorder-hint" hidden>
        Drag to reorder, or use the up and down arrow keys.
      </p>
      <VisuallyHidden>
        <span aria-live="polite">{announcement}</span>
      </VisuallyHidden>

      {loadError && projects.length === 0 ? (
        <div className="adm-empty">
          <p className="adm-empty__line adm-empty__line--error" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="hair-control adm-act"
            onClick={() => void load()}
          >
            retry
          </button>
        </div>
      ) : loading && projects.length === 0 ? (
        <div className="adm-skeletons" role="status" aria-label="Loading">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : projects.length === 0 ? (
        <div className="adm-empty">
          <p className="adm-empty__line">no projects yet.</p>
        </div>
      ) : (
        <ol
          ref={list}
          className={`adm-list adm-projects ${heldId ? 'is-dragging' : ''}`}
        >
          {projects.map((project, index) => (
            <li
              key={project.id}
              data-row
              className={[
                'adm-project',
                project.hidden && 'adm-project--hidden',
                heldId === project.id && 'is-held',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="adm-project__grip"
                data-grip={project.id}
                aria-label={`Reorder ${project.name}, position ${index + 1} of ${projects.length}`}
                aria-describedby="projects-reorder-hint"
                title="Drag, or use ↑ ↓"
                onPointerDown={(event) => onGripDown(event, project.id)}
                onKeyDown={(event) => onGripKey(event, project.id)}
              >
                <Icon name="grip" />
              </button>

              <button
                type="button"
                className="adm-project__open"
                aria-label={`Edit ${project.name}`}
                onClick={() => setEditing({ project })}
              >
                <Thumb project={project} />
                <span className="adm-project__text">
                  <span className="adm-project__title">
                    <span className="adm-project__name">{project.name}</span>
                    <span className="adm-project__year">{project.year}</span>
                    {project.featured && (
                      <span className="adm-project__flag">featured</span>
                    )}
                  </span>
                  <span className="adm-project__description">
                    {project.description}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="adm-icon-button adm-project__visibility"
                aria-pressed={project.hidden}
                aria-label={`Hide ${project.name} from the page`}
                title={
                  project.hidden
                    ? 'Hidden — show on the page'
                    : 'Hide from the page'
                }
                onClick={() => toggleHidden(project)}
              >
                <Icon name={project.hidden ? 'eye-off' : 'eye'} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <ProjectSheet
          project={editing.project}
          onSubmit={submit}
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
