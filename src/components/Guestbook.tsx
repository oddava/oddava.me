/** @jsxImportSource react */
import '../styles/components/_guestbook.css';
import { useCallback, useMemo, useState } from 'react';
import { useGuestbookEntries } from './guestbook/useGuestbookEntries';
import { useGuestbookSubmit } from './guestbook/useGuestbookSubmit';
import { useTurnstile } from './guestbook/useTurnstile';

const MAX_MESSAGE_LENGTH = 280;

export function Guestbook() {
  const {
    captchaRequired,
    entries,
    error,
    loading,
    refreshEntries,
    setError,
    turnstileSiteKey,
    writable,
    markPostingUnavailable,
  } = useGuestbookEntries();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const handleTurnstileError = useCallback(
    () =>
      markPostingUnavailable(
        'Guestbook posting is unavailable because bot verification could not load.',
      ),
    [markPostingUnavailable],
  );
  const { captchaToken, resetCaptcha, widgetContainerRef } = useTurnstile({
    enabled: captchaRequired && writable,
    onError: handleTurnstileError,
    siteKey: turnstileSiteKey,
  });
  const handleAfterSubmit = useCallback(async () => {
    setMessage('');
    resetCaptcha();
    await refreshEntries();
  }, [refreshEntries, resetCaptcha]);
  const { notice, setNotice, submitEntry, submitting } = useGuestbookSubmit({
    captchaToken,
    onAfterSubmit: handleAfterSubmit,
    setError,
  });

  const remaining = useMemo(
    () => MAX_MESSAGE_LENGTH - message.length,
    [message],
  );

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
        <h2>guestbook</h2>
        <p>leave a short note.</p>
      </header>

      <form className="guestbook__form" onSubmit={handleSubmit}>
        <label className="guestbook__field">
          <span>name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="anon"
            maxLength={32}
            autoComplete="nickname"
          />
        </label>
        <label className="guestbook__field">
          <span>message</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="say hi or leave a thought"
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
            required
          />
          <span
            className={`guestbook__count ${remaining < 0 ? 'is-over' : ''}`}
          >
            {remaining}
          </span>
        </label>
        {captchaRequired && writable && <div ref={widgetContainerRef} />}
        <button
          className="guestbook__submit"
          type="submit"
          disabled={
            submitting ||
            !message.trim() ||
            !writable ||
            (captchaRequired && !captchaToken)
          }
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
        {loading && <p className="guestbook__empty">Loading notes...</p>}
        {!loading && entries.length === 0 && (
          <p className="guestbook__empty">No notes yet.</p>
        )}
        {entries.map((entry) => (
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
