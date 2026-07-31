import '../styles/components/_guestbook.css';
import { useCallback, useMemo, useState } from 'preact/hooks';
import { useGuestbookEntries } from './guestbook/useGuestbookEntries';
import { useGuestbookSubmit } from './guestbook/useGuestbookSubmit';
import { SkeletonRow } from './admin/Skeleton';

const MAX_MESSAGE_LENGTH = 280;
const INITIAL_VISIBLE_ENTRIES = 12;

export function Guestbook() {
  const { entries, error, loading, refreshEntries, setError, writable } =
    useGuestbookEntries();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [showAllEntries, setShowAllEntries] = useState(false);
  const handleAfterSubmit = useCallback(async () => {
    setMessage('');
    await refreshEntries();
  }, [refreshEntries]);
  const { notice, setNotice, submitEntry, submitting } = useGuestbookSubmit({
    onAfterSubmit: handleAfterSubmit,
    setError,
  });

  const remaining = useMemo(
    () => MAX_MESSAGE_LENGTH - message.length,
    [message],
  );
  const visibleEntries = showAllEntries
    ? entries
    : entries.slice(0, INITIAL_VISIBLE_ENTRIES);
  const hiddenEntryCount = entries.length - visibleEntries.length;

  const handleSubmit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!message.trim() || !writable) return;

    setNotice(null);
    await submitEntry({
      message,
      name,
    });
  };

  return (
    <section className="guestbook">
      <header className="guestbook__header">
        <h2>Guestbook</h2>
        <p>
          i want to make this a better place. any feedback or ideas would be
          greatly appreciated!
        </p>
      </header>

      <form className="guestbook__form" onSubmit={handleSubmit}>
        <label className="guestbook__field">
          <span>name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="anon or preferebly twt username"
            maxLength={32}
            autoComplete="nickname"
          />
        </label>
        <label className="guestbook__field">
          <span>message</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder="say hi or leave a thought"
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
            required
            aria-required="true"
            aria-describedby="guestbook-message-count"
          />
          <span className="guestbook__count" id="guestbook-message-count">
            {remaining}
            <span className="sr-only"> characters remaining</span>
          </span>
        </label>
        <button
          className="guestbook__submit"
          type="submit"
          disabled={submitting || !message.trim() || !writable}
        >
          {submitting ? 'posting...' : 'submit'}
        </button>
        {!writable && (
          <p className="guestbook__error" role="alert">
            Guestbook posting is temporarily unavailable.
          </p>
        )}
      </form>

      <div className="guestbook__entries">
        {loading && (
          <div
            className="guestbook__skeletons"
            role="status"
            aria-live="polite"
          >
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}
        {!loading && entries.length === 0 && (
          <p className="guestbook__empty">No notes yet.</p>
        )}
        {visibleEntries.map((entry) => (
          <article key={entry.id} className="guestbook__entry">
            <div className="guestbook__meta">
              <span>{entry.name}</span>
              <span>
                {new Date(entry.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            <p>{entry.message}</p>
          </article>
        ))}
        {hiddenEntryCount > 0 && (
          <button
            type="button"
            className="guestbook__more"
            onClick={() => setShowAllEntries(true)}
          >
            show more ({hiddenEntryCount})
          </button>
        )}
        {notice && (
          <p className="guestbook__notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}
        {error && (
          <p className="guestbook__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
