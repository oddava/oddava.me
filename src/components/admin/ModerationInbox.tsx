import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { describeAgent, formatDate, formatRelative } from './format';
import { SkeletonRow } from '../ui/Skeleton';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { GuestbookStatus } from '../../lib/contracts';
import { errorMessage, useToast } from './toast';
import { useDialogConfirm } from './useDialogConfirm';

/** How long a decided entry takes to fold shut before it leaves the list. */
const FOLD_MS = 260;

/** Rows shown at once; "show more" adds as many again. */
const PAGE = 50;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Waits out the fold, or not at all when motion is reduced. */
const fold = () =>
  prefersReducedMotion()
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.setTimeout(resolve, FOLD_MS));

/** What every moderated record carries, whatever else it holds. */
export interface ModeratedEntry {
  id: string;
  status: GuestbookStatus;
  createdAt: string;
  ipFingerprint?: string;
  userAgent?: string;
}

export interface ModerationInboxProps<T extends ModeratedEntry> {
  /** The section's id and its heading. */
  id: string;
  title: string;
  /** Plural noun for the empty, error and toast lines: "entries", "stars". */
  noun: string;
  /** Entries waiting on a decision; the one count the tabs show. */
  pending?: number;
  /** Called after anything that moves entries between statuses. */
  onChanged: () => void;
  load: (status: GuestbookStatus) => Promise<T[]>;
  update: (id: string, status: GuestbookStatus) => Promise<unknown>;
  clear: () => Promise<unknown>;
  /** Who or what an entry is: its byline, and the name in its buttons. */
  name: (entry: T) => string;
  /** The entry's content, under its byline and above its metadata. */
  body: (entry: T) => ComponentChildren;
  /** What "clear unapproved" deletes, for its confirmation. */
  clearMessage: string;
  /**
   * Optional: rejects everything the network behind an entry left, and
   * answers how many. Shown on entries that carry a fingerprint.
   */
  rejectVisitor?: (entry: T) => Promise<number>;
  /**
   * Optional: rejects everything that came in during the last hour, from
   * anyone, and answers how many. For a flood from many addresses at once.
   */
  rejectLastHour?: () => Promise<number>;
}

const FILTERS: GuestbookStatus[] = ['pending', 'approved', 'rejected'];

const newestFirst = (a: ModeratedEntry, b: ModeratedEntry) =>
  b.createdAt.localeCompare(a.createdAt);

const VERB: Record<GuestbookStatus, string> = {
  pending: 'moved back to pending',
  approved: 'approved',
  rejected: 'rejected',
};

/**
 * An inbox: entries waiting on a decision, one tab per status. A decision
 * takes the entry off the list at once, with a short window to undo it, and
 * focus moves on to the next entry so the keyboard can keep going. The
 * guestbook and the sky both use it, each with its own store and rows.
 */
export function ModerationInbox<T extends ModeratedEntry>({
  id: sectionId,
  title,
  noun,
  pending,
  onChanged,
  load: loadEntries,
  update,
  clear,
  name,
  body,
  clearMessage,
  rejectVisitor,
  rejectLastHour,
}: ModerationInboxProps<T>) {
  type Lists = Partial<Record<GuestbookStatus, T[]>>;
  const one = noun.replace(/s$/, '').replace(/ie$/, 'y');
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
  /** How many rows of the open tab are shown. */
  const [shown, setShown] = useState(PAGE);
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
    return loadEntries(filter)
      .then((next) => {
        if (!current()) return;
        setLists((all) => ({ ...all, [filter]: next }));
      })
      .catch((error) => {
        if (!current()) return;
        setErrors((all) => ({
          ...all,
          [filter]: errorMessage(error, `could not load ${noun}.`),
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

  /** Every tab read again: after a change that moved many entries. */
  const reloadAll = () => {
    for (const filter of FILTERS) void load(filter);
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
    setShown(PAGE);
    void load(filter);
  };

  /** Moves an entry between the kept lists, as the store just did. */
  const move = (entry: T, to: GuestbookStatus) =>
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
    entry: T,
    next: GuestbookStatus,
    { offerUndo = true } = {},
  ) => {
    if (inFlight.current.has(entry.id) || inFlight.current.has('*')) return;
    mark(entry.id, true);
    try {
      await update(entry.id, next);
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
        message: `${name(entry)} ${VERB[next]}.`,
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
        message: errorMessage(error, `could not update the ${one}.`),
        tone: 'error',
      });
      // The list may no longer match the store; show what is really there.
      void load(statusRef.current);
    } finally {
      mark(entry.id, false);
    }
  };

  /** A bulk decision: confirmed, run, every tab read again. */
  const bulk = async (
    question: { title: string; message: string },
    run: () => Promise<number>,
  ) => {
    const ok = await confirm({
      ...question,
      confirmLabel: 'reject them all',
      cancelLabel: 'keep them',
      danger: true,
    });
    if (!ok || inFlight.current.size > 0) return;
    mark('*', true);
    try {
      const count = await run();
      reloadAll();
      focusNext.current = 'tabs';
      onChanged();
      toast.show({ message: `${count} ${count === 1 ? one : noun} rejected.` });
    } catch (error) {
      toast.show({
        message: errorMessage(error, `could not reject the ${noun}.`),
        tone: 'error',
      });
    } finally {
      mark('*', false);
    }
  };

  const rejectAllFrom = (entry: T) =>
    rejectVisitor &&
    void bulk(
      {
        title: 'reject everything from this network',
        message: `every ${one} left from the same address as ${name(
          entry,
        )} will be rejected and leave the site. you can approve them again one by one.`,
      },
      () => rejectVisitor(entry),
    );

  const rejectRecent = () =>
    rejectLastHour &&
    void bulk(
      {
        title: 'reject the last hour',
        message: `every ${one} that came in during the last hour, from anyone, will be rejected and leave the site. you can approve them again one by one.`,
      },
      rejectLastHour,
    );

  const clearUnapproved = async () => {
    const ok = await confirm({
      title: `clear unapproved ${noun}`,
      message: clearMessage,
      confirmLabel: `delete ${noun}`,
      cancelLabel: 'keep them',
      danger: true,
    });
    if (!ok || inFlight.current.size > 0) return;
    mark('*', true);
    try {
      await clear();
      setLists((all) => ({ ...all, pending: [], rejected: [] }));
      retireReads();
      // The button goes with the list it cleared; the tabs keep focus.
      focusNext.current = 'tabs';
      onChanged();
      toast.show({ message: `pending and rejected ${noun} deleted.` });
    } catch (error) {
      toast.show({
        message: errorMessage(error, `could not clear ${noun}.`),
        tone: 'error',
      });
    } finally {
      mark('*', false);
    }
  };

  const retry = () => {
    // The note and its button go as the read starts; the tabs keep focus.
    focusNext.current = 'tabs';
    void load(status);
  };

  return (
    <section
      id={sectionId}
      className="adm-section"
      aria-labelledby={`${sectionId}-title`}
    >
      <header className="adm-head">
        <h2 id={`${sectionId}-title`} className="adm-head__title">
          {title}
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
            onClick={retry}
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
            onClick={retry}
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
            <p className="adm-empty__line">
              no {status} {noun}.
            </p>
          </div>
        )
      ) : (
        <>
          <ul ref={listRef} className="adm-list">
            {entries.slice(0, shown).map((entry) => {
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
                      <strong>{name(entry)}</strong>
                      <time
                        className="adm-entry__when"
                        dateTime={entry.createdAt}
                        title={formatDate(entry.createdAt)}
                      >
                        {formatRelative(entry.createdAt)}
                      </time>
                    </p>
                    {body(entry)}
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
                        aria-label={`Approve ${name(entry)}`}
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
                        aria-label={`Reject ${name(entry)}`}
                        onClick={() => void moderate(entry, 'rejected')}
                      >
                        reject
                      </button>
                    )}
                    {rejectVisitor && entry.ipFingerprint && (
                      <button
                        type="button"
                        className="adm-button adm-button--small adm-button--quiet adm-button--danger"
                        aria-disabled={pending}
                        aria-label={`Reject everything from the network that left ${name(entry)}`}
                        onClick={() => {
                          if (!pending) rejectAllFrom(entry);
                        }}
                      >
                        all from this network
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {entries.length > shown && (
            <div className="adm-foot">
              <button
                type="button"
                className="adm-button adm-button--small adm-button--quiet"
                onClick={() => setShown((count) => count + PAGE)}
              >
                show {Math.min(PAGE, entries.length - shown)} more of{' '}
                {entries.length - shown}
              </button>
            </div>
          )}
          {(status !== 'approved' || rejectLastHour) && (
            <div className="adm-foot">
              {rejectLastHour && status !== 'rejected' && (
                <button
                  type="button"
                  className="adm-button adm-button--small adm-button--quiet adm-button--danger"
                  aria-disabled={busy.size > 0}
                  onClick={() => {
                    if (busy.size === 0) rejectRecent();
                  }}
                >
                  reject the last hour
                </button>
              )}
              {status !== 'approved' && (
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
              )}
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
