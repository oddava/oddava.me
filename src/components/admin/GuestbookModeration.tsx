import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  clearUnapprovedGuestbookEntries,
  fetchGuestbookEntries,
  updateGuestbookEntryStatus,
} from './api';
import { describeAgent, formatDate, formatRelative } from './format';
import { SkeletonRow } from '../ui/Skeleton';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { GuestbookEntry, GuestbookStatus } from '../../lib/contracts';
import { errorMessage, useToast } from './toast';
import { useDialogConfirm } from './useDialogConfirm';

interface GuestbookModerationProps {
  /** Entries waiting on a decision; the one count the tabs show. */
  pending?: number;
  /** Called after anything that moves entries between statuses. */
  onChanged: () => void;
}

const FILTERS: GuestbookStatus[] = ['pending', 'approved', 'rejected'];

const VERB: Record<GuestbookStatus, string> = {
  pending: 'moved back to pending',
  approved: 'approved',
  rejected: 'rejected',
};

/**
 * An inbox: entries waiting on a decision, one tab per status. A decision
 * takes the entry off the list at once, with a short window to undo it, and
 * focus moves on to the next entry so the keyboard can keep going.
 */
export function GuestbookModeration({
  pending,
  onChanged,
}: GuestbookModerationProps) {
  const toast = useToast();
  const { confirm, dialog } = useDialogConfirm();
  const [status, setStatus] = useState<GuestbookStatus>('pending');
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Entries with a decision in flight; '*' while everything is cleared. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const request = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const listRef = useRef<HTMLUListElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  /** Where focus goes after a decision removes the focused entry. */
  const focusAfter = useRef<number | null>(null);

  const load = useCallback((filter: GuestbookStatus) => {
    const requestId = ++request.current;
    setLoading(true);
    return fetchGuestbookEntries(filter)
      .then((next) => {
        if (requestId !== request.current) return;
        setEntries(next);
        setLoadError(null);
      })
      .catch((error) => {
        if (requestId !== request.current) return;
        setLoadError(errorMessage(error, 'could not load guestbook entries.'));
      })
      .finally(() => {
        if (requestId === request.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load(status);
    return () => {
      request.current += 1;
    };
  }, [status, load]);

  useEffect(() => {
    const index = focusAfter.current;
    if (index === null) return;
    focusAfter.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-entry]');
    const row = rows?.[Math.min(index, rows.length - 1)];
    const target =
      row?.querySelector<HTMLElement>('button') ??
      tabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    target?.focus();
  });

  /** The same set, read synchronously, so a double click cannot slip by. */
  const inFlight = useRef(new Set<string>());

  const mark = (id: string, on: boolean) => {
    if (on) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setBusy(new Set(inFlight.current));
  };

  const moderate = async (
    entry: GuestbookEntry,
    next: GuestbookStatus,
    { offerUndo = true } = {},
  ) => {
    if (inFlight.current.has(entry.id) || inFlight.current.has('*')) return;
    mark(entry.id, true);
    try {
      await updateGuestbookEntryStatus(entry.id, next);
      // The entry no longer matches this tab, so it leaves the list; if focus
      // was in it, the next entry takes it.
      const row = listRef.current?.querySelector(
        `[data-entry="${CSS.escape(entry.id)}"]`,
      );
      if (row && row.contains(document.activeElement)) {
        // Its place among the rows on screen now, not when the click began:
        // another decision may have landed in the meantime.
        const rows = Array.from(
          listRef.current?.querySelectorAll('[data-entry]') ?? [],
        );
        focusAfter.current = rows.indexOf(row);
      }
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      onChanged();
      toast.show({
        message: `${entry.name} ${VERB[next]}.`,
        undo: offerUndo
          ? async () => {
              await moderate({ ...entry, status: next }, entry.status, {
                offerUndo: false,
              });
              // Back on whichever tab is open now, not the one acted from.
              void load(statusRef.current);
            }
          : undefined,
      });
    } catch (error) {
      toast.show({
        message: errorMessage(error, 'could not update the entry.'),
        tone: 'error',
      });
      // The list may no longer match the store; show what is really there.
      void load(statusRef.current);
    } finally {
      mark(entry.id, false);
    }
  };

  const clearUnapproved = async () => {
    const ok = await confirm({
      title: 'clear unapproved entries',
      message:
        'every pending and rejected entry will be deleted. approved entries stay published. this cannot be undone.',
      confirmLabel: 'delete entries',
      cancelLabel: 'keep them',
      danger: true,
    });
    if (!ok) return;
    mark('*', true);
    try {
      await clearUnapprovedGuestbookEntries();
      setEntries([]);
      onChanged();
      toast.show({ message: 'pending and rejected entries deleted.' });
    } catch (error) {
      toast.show({
        message: errorMessage(error, 'could not clear entries.'),
        tone: 'error',
      });
    } finally {
      mark('*', false);
    }
  };

  return (
    <section
      id="guestbook"
      className="adm-section"
      aria-labelledby="guestbook-title"
    >
      <header className="adm-head">
        <h2 id="guestbook-title" className="adm-head__title">
          guestbook
        </h2>
        <div
          ref={tabsRef}
          className="adm-head__tools"
          role="group"
          aria-label="Show"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`hair-control adm-tab ${
                status === filter ? 'is-chosen' : ''
              }`}
              aria-pressed={status === filter}
              onClick={() => setStatus(filter)}
            >
              {filter}
              {filter === 'pending' && pending ? (
                <span className="adm-tab__count">{pending}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {loadError ? (
        <div className="adm-empty">
          <p className="adm-empty__line adm-empty__line--error" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="hair-control adm-act"
            onClick={() => void load(status)}
          >
            retry
          </button>
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="adm-skeletons" role="status" aria-label="Loading">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : entries.length === 0 ? (
        <div className="adm-empty">
          <p className="adm-empty__line">
            {status === 'pending'
              ? 'nothing waiting.'
              : `no ${status} entries.`}
          </p>
        </div>
      ) : (
        <>
          <ul ref={listRef} className="adm-list">
            {entries.map((entry) => {
              // aria-disabled, not disabled: a disabled button drops focus to
              // the page while its request is in flight.
              const pending = busy.has(entry.id) || busy.has('*');
              const meta = [
                entry.ipFingerprint?.slice(0, 8),
                entry.userAgent && describeAgent(entry.userAgent),
              ].filter(Boolean);
              return (
                <li key={entry.id} className="adm-entry" data-entry={entry.id}>
                  <div className="adm-entry__body">
                    <p className="adm-entry__by">
                      <strong>{entry.name}</strong>
                      <time
                        dateTime={entry.createdAt}
                        title={formatDate(entry.createdAt)}
                      >
                        {formatRelative(entry.createdAt)}
                      </time>
                    </p>
                    <p className="adm-entry__message">{entry.message}</p>
                    {meta.length > 0 && (
                      <p
                        className="adm-entry__meta"
                        title={entry.userAgent || undefined}
                      >
                        <VisuallyHidden>sent from </VisuallyHidden>
                        {meta.join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="adm-entry__actions">
                    {entry.status !== 'approved' && (
                      <button
                        type="button"
                        className="hair-control adm-act adm-act--go"
                        aria-disabled={pending}
                        aria-label={`Approve ${entry.name}`}
                        onClick={() => void moderate(entry, 'approved')}
                      >
                        approve
                      </button>
                    )}
                    {entry.status !== 'rejected' && (
                      <button
                        type="button"
                        className="hair-control adm-act"
                        aria-disabled={pending}
                        aria-label={`Reject ${entry.name}`}
                        onClick={() => void moderate(entry, 'rejected')}
                      >
                        reject
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {status !== 'approved' && (
            <div className="adm-foot">
              <button
                type="button"
                className="hair-control adm-act adm-act--quiet-danger"
                disabled={busy.size > 0}
                onClick={() => void clearUnapproved()}
              >
                clear unapproved
              </button>
            </div>
          )}
        </>
      )}
      {dialog}
    </section>
  );
}
