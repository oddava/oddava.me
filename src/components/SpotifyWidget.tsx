import React, { useEffect, useState, useRef } from 'react';
import './SpotifyWidget.css';

interface SpotifyData {
    isPlaying: boolean;
    title?: string;
    artist?: string;
    albumImageUrl?: string;
    songUrl?: string;
}

export default function SpotifyWidget() {
    const [data, setData] = useState<SpotifyData>({ isPlaying: false });
    const [loading, setLoading] = useState(true);

    const fetchPlaying = async () => {
        try {
            const res = await fetch('/api/spotify');
            const json = await res.json();
            setData(json);
        } catch (e) {
            console.error(e);
            setData({ isPlaying: false });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlaying();

        // Poll every 15 seconds
        const interval = setInterval(() => {
            fetchPlaying();
        }, 15000);

        return () => clearInterval(interval);
    }, []);

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
        // Only trigger drag if we aren't clicking a button
        if ((e.target as HTMLElement).closest('button')) {
            return;
        }

        // If we are clicking a link, we still allow dragging but don't preventDefault 
        // until we actually move, so the link remains clickable on a simple tap.
        setIsDragging(true);
        setTotalMovement(0);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;

        const deltaX = Math.abs(e.clientX - (dragStart.x + position.x));
        const deltaY = Math.abs(e.clientY - (dragStart.y + position.y));
        setTotalMovement(prev => prev + deltaX + deltaY);

        // If a drag is in progress, prevent default to stop text selection, etc.
        e.preventDefault();

        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;

        // Prevent dragging completely off screen
        const maxRight = window.innerWidth - 50;
        const maxBottom = window.innerHeight - 50;

        setPosition({
            x: Math.max(-window.innerWidth + 100, Math.min(newX, maxRight)),
            y: Math.max(-window.innerHeight + 100, Math.min(newY, maxBottom))
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        localStorage.setItem('spotify-widget-pos', JSON.stringify(position));

        // If movement was minimal, consider it a click to expand if minimized
        if (totalMovement < 10 && isMinimized) {
            setIsMinimized(false);
            localStorage.setItem('spotify-widget-minimized', 'false');
            // Prevent the subsequent 'click' event from triggering the link on mobile
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
            className={`spotify-widget-wrapper ${isDragging ? 'dragging' : ''}`}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <div className="spotify-widget-controls">
                <div /> {/* Spacer */}
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
                />
                <div className="spotify-widget-info">
                    <div className="spotify-widget-label">Now Playing</div>
                    <div className="spotify-widget-title">{data.title}</div>
                    <div className="spotify-widget-artist">{data.artist}</div>
                </div>
            </a>
        </div>
    );
}
