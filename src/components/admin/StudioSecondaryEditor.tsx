import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type {
  ContentCollectionMeta,
  ContentEntryListItem,
} from '../../lib/contracts';
import { renderNoteHtml } from '../../lib/garden/render';
import { fetchContentEntry, updateContentEntry } from './api';
import type { SaveState } from './studioSession';

interface Props {
  collection: ContentCollectionMeta;
  entryId: string;
  entries: ContentEntryListItem[];
  wikiLinkHrefs: Map<string, string>;
  autosave: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRevision: (id: string, revision: string, title: string) => void;
  onError: (message: string) => void;
  /** Mirrors this editor's save state so its tab can show it. */
  onStateChange: (id: string, state: SaveState) => void;
}

function titleFromBody(body: string, fallback: string): string {
  return (
    body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ||
    fallback.replaceAll('-', ' ')
  );
}

export default function StudioSecondaryEditor({
  collection,
  entryId,
  entries,
  wikiLinkHrefs,
  autosave,
  onActivate,
  onClose,
  onRevision,
  onError,
  onStateChange,
}: Props) {
  const [body, setBody] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [revision, setRevision] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [preview, setPreview] = useState(false);
  const loadingRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const bodyRef = useRef(body);
  const revisionRef = useRef(revision);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const fieldsRef = useRef(fields);

  const entry = entries.find((candidate) => candidate.id === entryId);
  const title = titleFromBody(body, entry?.title ?? entryId);
  const rendered = useMemo(
    () => renderNoteHtml(body, { wikiLinkHrefs }),
    [body, wikiLinkHrefs],
  );

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const saveNow = useCallback(async () => {
    const version = versionRef.current;
    if (!revisionRef.current || savedVersionRef.current >= version) return true;
    setState('saving');
    try {
      const response = await updateContentEntry(collection.id, entryId, {
        fields: fieldsRef.current,
        body: bodyRef.current,
        revision: revisionRef.current,
      });
      const nextRevision = response.entry?.revision ?? response.result.revision;
      if (!nextRevision) throw new Error('The save returned no revision.');
      revisionRef.current = nextRevision;
      setRevision(nextRevision);
      savedVersionRef.current = version;
      setState(versionRef.current === version ? 'saved' : 'dirty');
      onRevision(
        entryId,
        nextRevision,
        titleFromBody(bodyRef.current, entryId),
      );
      return true;
    } catch (caught) {
      setState('error');
      onError(
        caught instanceof Error ? caught.message : 'Could not save the file.',
      );
      return false;
    }
  }, [collection.id, entryId, onError, onRevision]);

  useEffect(() => {
    const request = ++loadingRef.current;
    if (saveTimerRef.current !== null)
      window.clearTimeout(saveTimerRef.current);
    setState('idle');
    void fetchContentEntry(collection.id, entryId)
      .then((response) => {
        if (request !== loadingRef.current) return;
        bodyRef.current = response.entry.body ?? '';
        fieldsRef.current = response.entry.fields;
        revisionRef.current = response.entry.revision;
        versionRef.current = 0;
        savedVersionRef.current = 0;
        setBody(response.entry.body ?? '');
        setFields(response.entry.fields);
        setRevision(response.entry.revision);
      })
      .catch((caught) => {
        if (request === loadingRef.current) {
          onError(
            caught instanceof Error
              ? caught.message
              : 'Could not open the file.',
          );
        }
      });
  }, [collection.id, entryId, onError]);

  useEffect(() => {
    if (!autosave || state !== 'dirty') return;
    if (saveTimerRef.current !== null)
      window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow();
    }, 700);
    return () => {
      if (saveTimerRef.current !== null)
        window.clearTimeout(saveTimerRef.current);
    };
  }, [autosave, state, body, saveNow]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (state === 'dirty' || state === 'saving' || state === 'error') {
        event.preventDefault();
        Reflect.set(event, 'returnValue', '');
      }
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  useEffect(() => {
    onStateChange(entryId, state);
    return () => onStateChange(entryId, 'idle');
  }, [entryId, onStateChange, state]);

  return (
    <section
      className="studio-editor studio-editor--secondary"
      aria-label={`Second editor: ${title}`}
      onFocus={onActivate}
    >
      <header className="studio-group-bar">
        <span className="studio-group-bar__path">{entry?.path ?? entryId}</span>
        <span className="studio-group-bar__state" data-tone={state}>
          {state === 'dirty'
            ? 'Unsaved'
            : state === 'saving'
              ? 'Saving…'
              : state === 'error'
                ? 'Save failed'
                : ''}
        </span>
        <button
          type="button"
          className="studio-group-bar__mode"
          onClick={() => setPreview((value) => !value)}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Close second editor"
          onClick={() => void saveNow().then((saved) => saved && onClose())}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m6 6 8 8M14 6l-8 8" />
          </svg>
        </button>
      </header>
      {preview ? (
        <div className="studio-preview">
          <article className="studio-preview__page">
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          </article>
        </div>
      ) : (
        <textarea
          className="studio-textarea studio-textarea--secondary"
          aria-label={`${title} body`}
          spellcheck
          value={body}
          onChange={(event) => {
            const value = event.currentTarget.value;
            bodyRef.current = value;
            versionRef.current += 1;
            setBody(value);
            setState('dirty');
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 's'
            ) {
              event.preventDefault();
              void saveNow();
            }
          }}
        />
      )}
      <div className="studio-status">
        <span>{body.trim() ? body.trim().split(/\s+/).length : 0} words</span>
        <span>Second editor</span>
      </div>
    </section>
  );
}
