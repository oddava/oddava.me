/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from 'react';

interface GuestbookEntry {
    id: string;
    name: string;
    message: string;
    createdAt: string;
}

interface GuestbookResponse {
    entries: GuestbookEntry[];
}

const POLL_INTERVAL = 12000;

export function Guestbook() {
    const [entries, setEntries] = useState<GuestbookEntry[]>([]);
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const optimisticIdRef = useRef<string | null>(null);

    const remaining = useMemo(() => 280 - message.length, [message]);

    const loadEntries = async () => {
        try {
            const response = await fetch('/api/guestbook', { cache: 'no-store' });
            if (!response.ok) throw new Error('Failed to load guestbook.');
            const data = (await response.json()) as GuestbookResponse;
            setEntries(data.entries ?? []);
            setError(null);
        } catch {
            setError('Could not load guestbook messages.');
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

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!message.trim()) return;

        const trimmedName = name.trim().slice(0, 32) || 'anon';
        const trimmedMessage = message.trim().slice(0, 280);
        const optimisticId = `optimistic-${Date.now()}`;
        optimisticIdRef.current = optimisticId;

        const optimisticEntry: GuestbookEntry = {
            id: optimisticId,
            name: trimmedName,
            message: trimmedMessage,
            createdAt: new Date().toISOString(),
        };

        setEntries((current) => [optimisticEntry, ...current]);
        setSubmitting(true);
        setError(null);
        setMessage('');

        try {
            const response = await fetch('/api/guestbook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: trimmedName, message: trimmedMessage }),
            });

            if (!response.ok) throw new Error('Failed to submit.');
            const data = (await response.json()) as GuestbookResponse;
            setEntries(data.entries ?? []);
            optimisticIdRef.current = null;
        } catch {
            setError('Could not post your message.');
            setEntries((current) => current.filter((entry) => entry.id !== optimisticId));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section className="guestbook">
            <header className="guestbook__header">
                <h2>guestbook</h2>
                <p>leave a short note. stay kind.</p>
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
                <button className="guestbook__submit" type="submit" disabled={submitting || !message.trim()}>
                    {submitting ? 'posting...' : 'post'}
                </button>
            </form>

            <div className="guestbook__entries">
                {loading && <p className="guestbook__empty">Loading notes...</p>}
                {!loading && entries.length === 0 && (
                    <p className="guestbook__empty">No notes yet. Be the first.</p>
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
                {error && <p className="guestbook__error">{error}</p>}
            </div>
        </section>
    );
}
