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

/** How long a decided entry takes to fold shut before it leaves the list. */
const FOLD_MS = 260;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Waits out the fold, or not at all when motion is reduced. */
const fold = () =>
  prefersReducedMotion()
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.setTimeout(resolve, FOLD_MS));

interface GuestbookModerationProps {
  /** Entries waiting on a decision; the one count the tabs show. */
  pending?: number;
  /** Called after anything that moves entries between statuses. */
  onChanged: () => void;
}

const FILTERS: GuestbookStatus[] = ['pending', 'approved', 'rejected'];

type Lists = Partial<Record<GuestbookStatus, GuestbookEntry[]>>;

const newestFirst = (a: GuestbookEntry, b: GuestbookEntry) =>
  b.createdAt.localeCompare(a.createdAt);

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
  /**
   * Every tab's list, kept once loaded, so switching tabs shows the right
   * entries at once (then refreshes them quietly) instead of the old tab's
   * rows, or a flash of loading, while the new list is fetched.
   */
  const [lists, setLists] = useState<Lists>({});
  const [errors, setErrors] = useState<
    Partial<Record<GuestbookStatus, string>>
  >({});
  const entries = lists[status];
  /** Nothing to show yet: the error takes the list's place. */
  const loadError = entries === undefined ? errors[status] : undefined;
  /** A refresh failed over a kept list: the rows stay, a note says so. */
  const refreshError = entries === undefined ? undefined : errors[status];
  /** Entries with a decision in flight; '*' while everything is cleared. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** Entries decided and folding shut, about to leave the list. */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  /** The latest request per tab; an older answer never overwrites it. */
  const requests = useRef<Partial<Record<GuestbookStatus, number>>>({});
  /** Tabs with a read in flight, so a change made meanwhile can retire it. */
  const reading = useRef(new Set<GuestbookStatus>());
  const mounted = useRef(true);
  const statusRef = useRef(status);
  statusRef.current = status;
  const listRef = useRef<HTMLUListElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  /** Where focus goes after a decision removes the focused entry. */
  const focusAfter = useRef<number | null>(null);
  /**
   * Where focus goes once a control that held it has gone: the undo in a
   * dismissed message, or "clear unapproved" once the list is empty.
   */
  const focusNext = useRef<{ entry: string } | 'tabs' | null>(null);

  const load = useCallback((filter: GuestbookStatus) => {
    const requestId = (requests.current[filter] ?? 0) + 1;
    requests.current[filter] = requestId;
    const current = () =>
      mounted.current && requests.current[filter] === requestId;
    reading.current.add(filter);
    // A retry starts clean: the old error does not flash (or announce)
    // while the new read is on its way.
    setErrors(({ [filter]: _, ...rest }) => rest);
    return fetchGuestbookEntries(filter)
      .then((next) => {
        if (!current()) return;
        setLists((all) => ({ ...all, [filter]: next }));
      })
      .catch((error) => {
        if (!current()) return;
        setErrors((all) => ({
          ...all,
          [filter]: errorMessage(error, 'could not load guestbook entries.'),
        }));
      })
      .finally(() => {
        if (requests.current[filter] === requestId) {
          reading.current.delete(filter);
        }
      });
  }, []);

  /**
   * A read that set out before a change landed would answer with the store
   * as it was, and undo the change on screen. Each one still in flight is
   * read again: the newer request retires the older answer.
   */
  const retireReads = () => {
    for (const filter of FILTERS) {
      if (reading.current.has(filter)) void load(filter);
    }
  };

  useEffect(() => {
    mounted.current = true;
    // The inbox first; the other two tabs load behind it, so the first
    // switch to them is instant too.
    void load('pending').finally(() => {
      void load('approved');
      void load('rejected');
    });
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** A tab switch shows the kept list at once and refreshes it quietly. */
  const choose = (filter: GuestbookStatus) => {
    if (filter === statusRef.current) return;
    setStatus(filter);
    void load(filter);
  };

  /** Moves an entry between the kept lists, as the store just did. */
  const move = (entry: GuestbookEntry, to: GuestbookStatus) =>
    setLists((all) => {
      const next: Lists = { ...all };
      for (const filter of FILTERS) {
        const list = next[filter];
        if (!list) continue;
        const without = list.filter((item) => item.id !== entry.id);
        next[filter] =
          filter === to
            ? [...without, { ...entry, status: to }].sort(newestFirst)
            : without;
      }
      return next;
    });

  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    // Only when focus was left with nowhere to be; a reader who has moved
    // on is not pulled back.
    if (document.activeElement && document.activeElement !== document.body) {
      return;
    }
    const target =
      (next !== 'tabs' &&
        listRef.current?.querySelector<HTMLElement>(
          `[data-entry="${CSS.escape(next.entry)}"] button`,
        )) ||
      tabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    target?.focus();
  });

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
      // It folds shut along its line first, so the decision is seen to land
      // before the next entry slides up into its place.
      const row = listRef.current?.querySelector<HTMLElement>(
        `[data-entry="${CSS.escape(entry.id)}"]`,
      );
      // The fold runs from the row's real height, not a guessed maximum.
      row?.style.setProperty('--adm-fold-from', `${row.offsetHeight}px`);
      setLeaving((current) => new Set(current).add(entry.id));
      await fold();
      if (row && row.contains(document.activeElement)) {
        // Its place among the rows on screen now, not when the click began:
        // another decision may have landed in the meantime.
        const rows = Array.from(
          listRef.current?.querySelectorAll('[data-entry]') ?? [],
        );
        focusAfter.current = rows.indexOf(row);
      }
      move(entry, next);
      retireReads();
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
      onChanged();
      toast.show({
        message: `${entry.name} ${VERB[next]}.`,
        undo: offerUndo
          ? async () => {
              await moderate({ ...entry, status: next }, entry.status, {
                offerUndo: false,
              });
              // The undo button left with its message: focus goes to the
              // entry if it is back on the open tab, else to the tabs.
              focusNext.current = { entry: entry.id };
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
    if (!ok || inFlight.current.size > 0) return;
    mark('*', true);
    try {
      await clearUnapprovedGuestbookEntries();
      setLists((all) => ({ ...all, pending: [], rejected: [] }));
      retireReads();
      // The button goes with the list it cleared; the tabs keep focus.
      focusNext.current = 'tabs';
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
        <div ref={tabsRef} className="adm-seg" role="group" aria-label="show">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={status === filter}
              onClick={() => choose(filter)}
            >
              {filter}
              {filter === 'pending' && pending ? (
                <span className="adm-seg__count">{pending}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {refreshError && (
        <div className="adm-stale" role="status">
          <p>could not refresh; showing the last list.</p>
          <button
            type="button"
            className="adm-button adm-button--small adm-button--quiet"
            onClick={() => {
              // The note and its button go as the read starts; the tabs
              // keep focus.
              focusNext.current = 'tabs';
              void load(status);
            }}
          >
            retry
          </button>
        </div>
      )}

      {loadError ? (
        <div className="adm-empty">
          <p className="adm-empty__line adm-empty__line--error" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="adm-button adm-button--small"
            onClick={() => {
              // The note and its button go as the read starts; the tabs
              // keep focus.
              focusNext.current = 'tabs';
              void load(status);
            }}
          >
            retry
          </button>
        </div>
      ) : entries === undefined ? (
        <div className="adm-skeletons" role="status" aria-label="loading">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : entries.length === 0 ? (
        status === 'pending' ? (
          <QuietInbox />
        ) : (
          <div className="adm-empty">
            <p className="adm-empty__line">no {status} entries.</p>
          </div>
        )
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
                <li
                  key={entry.id}
                  className={`adm-entry ${
                    leaving.has(entry.id) ? 'is-leaving' : ''
                  }`}
                  data-entry={entry.id}
                >
                  <div className="adm-entry__body">
                    <p className="adm-entry__by">
                      <strong>{entry.name}</strong>
                      <time
                        className="adm-entry__when"
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
                        className="adm-button adm-button--small adm-button--tonal"
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
                        className="adm-button adm-button--small adm-button--quiet"
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
                className="adm-button adm-button--small adm-button--quiet adm-button--danger"
                aria-disabled={busy.size > 0}
                onClick={() => {
                  if (busy.size === 0) void clearUnapproved();
                }}
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

/**
 * Nothing waiting: an empty slot in the shape of the projects page's
 * picture-less card — a faint dot grid, the words in the middle, the site's
 * small face asleep beside them.
 */
function QuietInbox() {
  return (
    <div className="adm-quiet">
      <p>
        nothing waiting <span aria-hidden="true">( ˘ω˘ )</span>
      </p>
    </div>
  );
}
