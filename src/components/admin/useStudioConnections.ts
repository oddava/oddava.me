import { useEffect, useState } from 'preact/hooks';
import type { NoteConnections, TagCount } from '../../lib/garden/connections';
import { fetchConnections } from './api/connections';

export type ConnectionsState = {
  status: 'loading' | 'ready' | 'error';
  /** Absent until the first answer; the previous note's is never shown. */
  connections: NoteConnections | null;
  /** Kept across notes: the tag vocabulary does not depend on which is open. */
  tags: TagCount[];
};

/** A save burst settles before the index is asked again. */
const REFRESH_DELAY_MS = 600;

/**
 * Backlinks, outgoing links and the tag vocabulary for the open note.
 *
 * Fetched after the note has loaded and again after each save — the server
 * builds these from stored notes, so nothing the keystrokes have not saved
 * yet could be in them. Never on a keystroke.
 */
export function useStudioConnections(
  noteId: string | null,
  savedAt: number | null,
): ConnectionsState {
  const [state, setState] = useState<ConnectionsState>({
    status: 'loading',
    connections: null,
    tags: [],
  });

  useEffect(() => {
    if (!noteId) return;
    const abort = new AbortController();
    const timer = window.setTimeout(
      () => {
        fetchConnections(noteId, abort.signal)
          .then((payload) =>
            setState({
              status: 'ready',
              connections: payload.connections,
              tags: payload.tags,
            }),
          )
          .catch(() => {
            // Aborting is the next note or save taking over, not a failure.
            if (abort.signal.aborted) return;
            setState((current) => ({
              ...current,
              status: 'error',
              connections:
                current.connections?.id === noteId ? current.connections : null,
            }));
          });
      },
      // The first look at a note is not a save burst; no reason to wait.
      savedAt === null ? 0 : REFRESH_DELAY_MS,
    );
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [noteId, savedAt]);

  // A note switch must not flash the last note's links under the new one.
  return state.connections && state.connections.id !== noteId
    ? { ...state, status: 'loading', connections: null }
    : state;
}
