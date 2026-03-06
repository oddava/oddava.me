/** @jsxImportSource react */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

interface ClickerState {
    count: number;
}

interface ConfettiPiece {
    id: number;
    x: number;
    y: number;
    spin: number;
    delay: number;
    color: string;
}

const MILESTONE_STEP = 100;
const CONFETTI_COLORS = ['#f6d365', '#fda085', '#a8edea', '#fed6e3', '#89f7fe', '#d4a5ff'];

export function CommunityClicker() {
    const [count, setCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bursts, setBursts] = useState<number[]>([]);
    const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);
    const [milestone, setMilestone] = useState<number | null>(null);
    const lastMilestoneRef = useRef<number | null>(null);
    const confettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastClickAtRef = useRef(0);

    const clearConfetti = () => {
        setConfetti([]);
        setMilestone(null);
        if (confettiTimeoutRef.current) {
            clearTimeout(confettiTimeoutRef.current);
            confettiTimeoutRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            if (confettiTimeoutRef.current) {
                clearTimeout(confettiTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!count || count < MILESTONE_STEP || count % MILESTONE_STEP !== 0) return;
        if (lastMilestoneRef.current === count) return;

        lastMilestoneRef.current = count;
        setMilestone(count);

        const nextConfetti = Array.from({ length: 18 }, (_, index) => ({
            id: Date.now() + index,
            x: Math.round((Math.random() - 0.5) * 150),
            y: -1 * (45 + Math.round(Math.random() * 50)),
            spin: Math.round((Math.random() - 0.5) * 720),
            delay: Math.round(Math.random() * 120),
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        }));

        setConfetti(nextConfetti);

        if (confettiTimeoutRef.current) {
            clearTimeout(confettiTimeoutRef.current);
        }
        confettiTimeoutRef.current = setTimeout(() => {
            clearConfetti();
        }, 1500);
    }, [count]);

    useEffect(() => {
        let mounted = true;

        const loadCount = async () => {
            try {
                const response = await fetch('/api/clicker');
                if (!response.ok) throw new Error('Failed to load');
                const data = (await response.json()) as ClickerState;
                if (mounted) {
                    setCount(data.count);
                    setError(null);
                }
            } catch {
                if (mounted) setError('Could not load click count.');
            }
        };

        loadCount();
        const interval = setInterval(loadCount, 5000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    const handleClick = async () => {
        const now = Date.now();
        if (now - lastClickAtRef.current < 120) return;
        lastClickAtRef.current = now;

        setCount((current) => (current ?? 0) + 1);
        const burstId = Date.now() + Math.floor(Math.random() * 1000);
        setBursts((current) => [...current, burstId]);
        setError(null);

        try {
            const response = await fetch('/api/clicker?op=hit', { method: 'GET', cache: 'no-store' });
            if (!response.ok) throw new Error('Failed to increment');
            const data = (await response.json()) as ClickerState;
            setCount((current) => (current === null ? data.count : Math.max(current, data.count)));
        } catch {
            setError('Could not update click count.');
            setCount((current) => (current === null ? 0 : Math.max(0, current - 1)));
        }
    };

    return (
        <div className="community-clicker">
            <p className="community-clicker__lead">A tiny shared counter for everyone visiting this page.</p>
            <div className="community-clicker__count" aria-live="polite">
                {count ?? '...'}
                <div className="community-clicker__bursts" aria-hidden="true">
                    {bursts.map((burstId) => (
                        <span
                            key={burstId}
                            className="community-clicker__burst"
                            onAnimationEnd={() => {
                                setBursts((current) => current.filter((id) => id !== burstId));
                            }}
                        >
                            +1
                        </span>
                    ))}
                </div>
                <div className="community-clicker__confetti" aria-hidden="true">
                    {confetti.map((piece) => (
                        <span
                            key={piece.id}
                            className="community-clicker__confetti-piece"
                            style={{
                                '--piece-x': `${piece.x}px`,
                                '--piece-y': `${piece.y}px`,
                                '--piece-spin': `${piece.spin}deg`,
                                '--piece-delay': `${piece.delay}ms`,
                                '--piece-color': piece.color,
                            } as CSSProperties}
                        />
                    ))}
                </div>
            </div>
            <button
                className="community-clicker__button"
                onClick={handleClick}
            >
                <span className="community-clicker__button-text">click</span>
                <span className="community-clicker__button-sizer" aria-hidden="true">click</span>
            </button>
            {milestone && <p className="community-clicker__milestone">Milestone unlocked: {milestone} clicks!</p>}
            <p className="community-clicker__hint">It refreshes every few seconds, so you can see other visitors click too.</p>
            {error && <p className="community-clicker__error">{error}</p>}
        </div>
    );
}
