import React, { useEffect, useState, useRef } from 'react';
import './SpotifyWidget.css';

interface SpotifyData {
    isPlaying: boolean;
    title?: string;
    artist?: string;
    albumImageUrl?: string;
    songUrl?: string;
    durationMs?: number;
    progressMs?: number;
}

export default function SpotifyWidget() {
    const [data, setData] = useState<SpotifyData>({ isPlaying: false });
    const [loading, setLoading] = useState(true);
    const [currentProgress, setCurrentProgress] = useState(0);

    const fetchPlaying = async () => {
        try {
            const res = await fetch('/api/spotify');
            const json = await res.json();
            setData(json);
            if (json.progressMs) {
                setCurrentProgress(json.progressMs);
            }
        } catch (e) {
            console.error(e);
            setData({ isPlaying: false });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlaying();
        const interval = setInterval(fetchPlaying, 15000);
        return () => clearInterval(interval);
    }, []);

    // Live counter for progress
    useEffect(() => {
        if (!data.isPlaying || !data.durationMs) return;

        const timer = setInterval(() => {
            setCurrentProgress(prev => {
                if (prev + 1000 >= (data.durationMs || 0)) {
                    return data.durationMs || 0;
                }
                return prev + 1000;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [data.isPlaying, data.durationMs]);

    const formatTime = (ms: number) => {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor(ms / (1000 * 60));
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const progressPercent = data.durationMs ? (currentProgress / data.durationMs) * 100 : 0;

    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isMinimized, setIsMinimized] = useState(false);

    // Load saved position from local storage
    useEffect(() => {
        const savedPos = localStorage.getItem('spotify-widget-pos');
        if (savedPos) {
            try {
                setPosition(JSON.parse(savedPos));
            } catch (e) {
                // ignore
            }
        }

        const savedMin = localStorage.getItem('spotify-widget-minimized');
        if (savedMin) {
            setIsMinimized(savedMin === 'true');
        }
    }, []);

    const [totalMovement, setTotalMovement] = useState(0);
    const preventClickRef = useRef(false);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button')) {
            return;
        }

        setIsDragging(true);
        setTotalMovement(0);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;

        const deltaX = Math.abs(e.clientX - (dragStart.x + position.x));
        const deltaY = Math.abs(e.clientY - (dragStart.y + position.y));
        const newTotal = totalMovement + deltaX + deltaY;

        // Take pointer capture only when a genuine drag begins.
        // Doing this conditionally allows simple taps to register as native link clicks!
        if (newTotal >= 5) {
            try {
                if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }
            } catch (err) { }
        }

        setTotalMovement(prev => prev + deltaX + deltaY);

        e.preventDefault();

        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;

        const maxRight = window.innerWidth - 50;
        const maxBottom = window.innerHeight - 50;

        setPosition({
            x: Math.max(-window.innerWidth + 100, Math.min(newX, maxRight)),
            y: Math.max(-window.innerHeight + 100, Math.min(newY, maxBottom))
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        try {
            if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            }
        } catch (err) { }

        localStorage.setItem('spotify-widget-pos', JSON.stringify(position));

        if (totalMovement < 10 && isMinimized) {
            setIsMinimized(false);
            localStorage.setItem('spotify-widget-minimized', 'false');
            preventClickRef.current = true;
            setTimeout(() => { preventClickRef.current = false; }, 300);
        } else if (totalMovement >= 10) {
            preventClickRef.current = true;
            setTimeout(() => { preventClickRef.current = false; }, 300);
        }
    };

    const toggleMinimize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const newVal = !isMinimized;
        setIsMinimized(newVal);
        localStorage.setItem('spotify-widget-minimized', String(newVal));
    };

    if (loading || !data.isPlaying) {
        return null;
    }

    if (isMinimized) {
        return (
            <div
                className="spotify-widget-container minimized"
                style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                title="Currently listening to Spotify. Click to expand."
            >
                <div className="spotify-widget-drag-handle">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--color-accent)">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.45 17.348c-.201.332-.63.438-.962.237-2.637-1.61-5.94-1.976-9.84-.108-.372.178-.813.018-.99-.355-.177-.373-.018-.813.355-.99 4.28-2.052 7.94-1.636 10.865.153.333.203.44.632.237.962zm1.388-3.094c-.255.42-.792.56-1.213.305-3.018-1.85-7.61-2.4-10.74-1.314-.467.162-.97-.087-1.134-.555-.163-.466.088-.97.556-1.133 3.633-1.262 8.73-.637 12.227 1.512.422.256.561.793.305 1.217zm.11-3.237C15.26 8.814 8.868 8.59 5.165 9.714c-.55.166-1.127-.145-1.293-.695-.165-.55.146-1.127.696-1.293 4.267-1.29 11.36-1.023 15.655 1.527.49.29.652.92.36 1.41-.29.492-.92.653-1.41.36z" />
                    </svg>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`spotify-widget-wrapper ${isDragging && totalMovement > 10 ? 'dragging' : ''}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <div className="spotify-widget-controls">
                <div />
                <button className="spotify-widget-minimize action-btn" onClick={toggleMinimize} aria-label="Minimize widget">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>
            <a
                href={data.songUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="spotify-widget-container"
                title="Listening on Spotify"
                draggable="false"
                onClick={(e) => {
                    if (preventClickRef.current) {
                        e.preventDefault();
                    }
                }}
            >
                <img
                    src={data.albumImageUrl}
                    alt={data.title}
                    className="spotify-widget-album"
                    draggable="false"
                />
                <div className="spotify-widget-info">
                    <div className="spotify-widget-label">Now Playing</div>
                    <div className="spotify-widget-title">{data.title}</div>
                    <div className="spotify-widget-artist">{data.artist}</div>

                    {data.durationMs && (
                        <div className="spotify-widget-progress-container">
                            <div className="spotify-widget-progress-bar">
                                <div
                                    className="spotify-widget-progress-fill"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div className="spotify-widget-time">
                                <span>{formatTime(currentProgress)}</span>
                                <span>{formatTime(data.durationMs)}</span>
                            </div>
                        </div>
                    )}
                </div>
            </a>
        </div>
    );
}
