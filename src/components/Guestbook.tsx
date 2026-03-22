/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';

interface GuestbookEntry {
    id: string;
    name: string;
    message: string;
    createdAt: string;
}

interface GuestbookResponse {
    entries?: GuestbookEntry[];
    writable?: boolean;
    reviewRequired?: boolean;
    captchaRequired?: boolean;
    submitted?: boolean;
    message?: string;
    error?: string;
    retryAfterSeconds?: number;
}

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: {
                sitekey: string;
                callback: (token: string) => void;
                'expired-callback'?: () => void;
                'error-callback'?: () => void;
                theme?: 'light' | 'dark' | 'auto';
            }) => string;
            reset: (widgetId?: string) => void;
        };
    }
}

const POLL_INTERVAL = 12000;
const TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function ensureTurnstileScript(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.turnstile) return Promise.resolve();

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    if (existingScript) {
        return new Promise((resolve, reject) => {
            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Failed to load Turnstile.')), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Turnstile.'));
        document.head.appendChild(script);
    });
}

export function Guestbook() {
    const [entries, setEntries] = useState<GuestbookEntry[]>([]);
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [writable, setWritable] = useState(true);
    const [captchaRequired, setCaptchaRequired] = useState(false);
    const [captchaToken, setCaptchaToken] = useState('');
    const widgetContainerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);

    const remaining = useMemo(() => 280 - message.length, [message]);

    const loadEntries = async () => {
        try {
            const response = await fetch('/api/guestbook', { cache: 'no-store' });
            const data = (await response.json()) as GuestbookResponse;
            if (!response.ok) throw new Error(data.error || 'Failed to load guestbook.');
            setEntries(data.entries ?? []);
            setWritable(data.writable !== false);
            setCaptchaRequired(Boolean(data.captchaRequired && TURNSTILE_SITE_KEY));
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Could not load guestbook messages.');
            setWritable(false);
            setCaptchaRequired(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let mounted = true;
        const fetchEntries = async () => {
            if (!mounted) return;
            await loadEntries();
        };

        fetchEntries();
        const interval = setInterval(fetchEntries, POLL_INTERVAL);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (!captchaRequired || !widgetContainerRef.current || !writable) return;
        if (widgetIdRef.current) return;

        ensureTurnstileScript()
            .then(() => {
                if (!widgetContainerRef.current || !window.turnstile || widgetIdRef.current) return;
                widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
                    sitekey: TURNSTILE_SITE_KEY,
                    callback: (token) => setCaptchaToken(token),
                    'expired-callback': () => setCaptchaToken(''),
                    'error-callback': () => setCaptchaToken(''),
                    theme: 'auto',
                });
            })
            .catch(() => {
                setWritable(false);
                setError('Guestbook posting is unavailable because bot verification could not load.');
            });
    }, [captchaRequired, writable]);

    const handleSubmit = async (event: { preventDefault(): void }) => {
        event.preventDefault();
        if (!message.trim() || !writable) return;

        const trimmedName = name.trim().slice(0, 32) || 'anon';
        const trimmedMessage = message.trim().slice(0, 280);

        setSubmitting(true);
        setError(null);
        setNotice(null);

        try {
            const response = await fetch('/api/guestbook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: trimmedName, message: trimmedMessage, captchaToken }),
            });

            const data = (await response.json()) as GuestbookResponse;
            if (!response.ok) {
                throw new Error(
                    data.retryAfterSeconds
                        ? `${data.error ?? 'Could not post your message.'} Try again in ${data.retryAfterSeconds}s.`
                        : data.error ?? 'Could not post your message.',
                );
            }

            setMessage('');
            setNotice(data.message ?? 'Thanks. You note will appear soon.');
            setCaptchaToken('');
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.reset(widgetIdRef.current);
            }
            await loadEntries();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Could not post your message.');
        } finally {
            setSubmitting(false);
        }
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
                        maxLength={280}
                        rows={3}
                        required
                    />
                    <span className={`guestbook__count ${remaining < 0 ? 'is-over' : ''}`}>{remaining}</span>
                </label>
                {captchaRequired && writable && <div ref={widgetContainerRef} />}
                <button
                    className="guestbook__submit"
                    type="submit"
                    disabled={submitting || !message.trim() || !writable || (captchaRequired && !captchaToken)}
                >
                    {submitting ? 'posting...' : 'submit'}
                </button>
                {!writable && (
                    <p className="guestbook__error">Guestbook posting is temporarily unavailable.</p>
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
                            <span>{new Date(entry.createdAt).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                            })}</span>
                        </div>
                        <p>{entry.message}</p>
                    </article>
                ))}
                {notice && <p>{notice}</p>}
                {error && <p className="guestbook__error">{error}</p>}
            </div>
        </section>
    );
}
