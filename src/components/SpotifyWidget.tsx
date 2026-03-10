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
    const widgetRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<SpotifyData>({ isPlaying: false });
    const [loading, setLoading] = useState(true);
    const [currentProgress, setCurrentProgress] = useState(0);

    const [renderState, setRenderState] = useState<'hidden' | 'entering' | 'active' | 'exiting'>('hidden');
    const [displayData, setDisplayData] = useState<SpotifyData | null>(null);

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

    useEffect(() => {
        if (loading) return;

        if (data.isPlaying) {
            setDisplayData(data);
            setRenderState(prev => {
                if (prev === 'hidden' || prev === 'exiting') {
                    setTimeout(() => setRenderState('active'), 50);
                    return 'entering';
                }
                return prev;
            });
        } else {
            setRenderState(prev => {
                if (prev === 'active' || prev === 'entering') {
                    setTimeout(() => {
                        setRenderState('hidden');
                    }, 300); // match exit CSS duration
                    return 'exiting';
                }
                return prev;
            });
        }
    }, [loading, data.isPlaying, data]);

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

    const progressPercent = displayData?.durationMs ? (currentProgress / displayData.durationMs) * 100 : 0;

    const [pos, setPos] = useState({
        edgeX: 'left',
        edgeY: 'bottom',
        offsetX: 32,
        offsetY: 32
    });
    const [isDragging, setIsDragging] = useState(false);

    // Refs for performance - avoids useEffect churn
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const initialPointerRef = useRef({ x: 0, y: 0 });
    const posRef = useRef(pos);
    const rAFRef = useRef<number | null>(null);

    // Keep posRef in sync for the listener
    useEffect(() => {
        posRef.current = pos;
    }, [pos]);

    const [isMinimized, setIsMinimized] = useState(false);

    // Load saved position and handle responsiveness
    useEffect(() => {
        const clampPos = (p: typeof pos) => {
            const newPos = { ...p };
            if (newPos.offsetX > window.innerWidth - 60) newPos.offsetX = 16;
            if (newPos.offsetY > window.innerHeight - 60) newPos.offsetY = 16;
            return newPos;
        };

        const savedPos = localStorage.getItem('spotify-widget-pos-v2');
        if (savedPos) {
            try {
                const parsed = clampPos(JSON.parse(savedPos));
                setPos(parsed);
                posRef.current = parsed;
            } catch (e) { /* ignore */ }
        } else {
            setPos(prev => clampPos(prev));
        }

        const handleResize = () => {
            setPos(prev => {
                const updated = clampPos(prev);
                posRef.current = updated;
                return updated;
            });
        };

        window.addEventListener('resize', handleResize);

        const savedMin = localStorage.getItem('spotify-widget-minimized');
        if (savedMin) {
            setIsMinimized(savedMin === 'true');
        }

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const [totalMovement, setTotalMovement] = useState(0);
    const preventClickRef = useRef(false);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('.action-btn')) {
            return;
        }

        const currentTarget = e.currentTarget as HTMLElement;
        if (e.pointerType === 'touch') {
            currentTarget.setPointerCapture(e.pointerId);
        }

        const rect = currentTarget.getBoundingClientRect();

        setIsDragging(true);
        setTotalMovement(0);
        dragOffsetRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        initialPointerRef.current = { x: e.clientX, y: e.clientY };
    };

    useEffect(() => {
        if (!isDragging) return;

        const handleMove = (e: PointerEvent) => {
            if (rAFRef.current) return; // limit to screen refresh rate

            rAFRef.current = requestAnimationFrame(() => {
                rAFRef.current = null;

                const deltaX = Math.abs(e.clientX - initialPointerRef.current.x);
                const deltaY = Math.abs(e.clientY - initialPointerRef.current.y);
                const newTotal = deltaX + deltaY;
                setTotalMovement(newTotal);

                const rect = widgetRef.current?.getBoundingClientRect();
                if (!rect) return;

                let left = e.clientX - dragOffsetRef.current.x;
                let top = e.clientY - dragOffsetRef.current.y;

                const maxLeft = window.innerWidth - rect.width - 16;
                const maxTop = window.innerHeight - rect.height - 16;

                left = Math.max(16, Math.min(left, maxLeft));
                top = Math.max(16, Math.min(top, maxTop));

                const cx = left + rect.width / 2;
                const cy = top + rect.height / 2;

                const edgeX = cx > window.innerWidth / 2 ? 'right' : 'left';
                const edgeY = cy > window.innerHeight / 2 ? 'bottom' : 'top';

                const offsetX = edgeX === 'left' ? left : window.innerWidth - (left + rect.width);
                const offsetY = edgeY === 'top' ? top : window.innerHeight - (top + rect.height);

                setPos({ edgeX, edgeY, offsetX, offsetY });
            });
        };

        const handleUp = () => {
            setIsDragging(false);
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            rAFRef.current = null;

            localStorage.setItem('spotify-widget-pos-v2', JSON.stringify(posRef.current));

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

        window.addEventListener('pointermove', handleMove, { passive: true });
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);

        return () => {
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    }, [isDragging, isMinimized, totalMovement]);

    const toggleMinimize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const newVal = !isMinimized;
        setIsMinimized(newVal);
        localStorage.setItem('spotify-widget-minimized', String(newVal));
    };

    if (renderState === 'hidden' || !displayData) {
        return null;
    }

    const alignmentClasses = `side-${pos.edgeX} side-${pos.edgeY}`;

    const style: React.CSSProperties = {
        left: pos.edgeX === 'left' ? `${pos.offsetX}px` : 'auto',
        right: pos.edgeX === 'right' ? `${pos.offsetX}px` : 'auto',
        top: pos.edgeY === 'top' ? `${pos.offsetY}px` : 'auto',
        bottom: pos.edgeY === 'bottom' ? `${pos.offsetY}px` : 'auto',
        touchAction: 'none'
    };

    return (
        <div
            ref={widgetRef}
            className={`spotify-widget-positioner ${isDragging && totalMovement > 10 ? 'dragging' : ''}`}
            style={style}
            onPointerDown={handlePointerDown}
        >
            <div className={`spotify-widget-wrapper render-${renderState} ${isMinimized ? 'is-minimized' : ''} ${alignmentClasses}`}>

                {/* Full View */}
                <div className="spotify-widget-full-view">
                    <div className="spotify-widget-controls">
                        <div />
                        <button className="spotify-widget-minimize action-btn" onClick={toggleMinimize} aria-label="Minimize widget">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                    <div
                        className="spotify-widget-container"
                        draggable="false"
                    >
                        <img
                            src={displayData.albumImageUrl}
                            alt={displayData.title}
                            className="spotify-widget-album"
                            draggable="false"
                            onDragStart={(e) => e.preventDefault()}
                        />
                        <div className="spotify-widget-info">
                            <div className="spotify-widget-label">listening to</div>
                            <a
                                href={displayData.songUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="spotify-widget-title"
                                title="Listening on Spotify"
                                onClick={(e) => {
                                    if (preventClickRef.current) {
                                        e.preventDefault();
                                    }
                                }}
                            >
                                {displayData.title}
                            </a>
                            <div className="spotify-widget-artist">{displayData.artist}</div>

                            {displayData.durationMs && (
                                <div className="spotify-widget-progress-container">
                                    <div className="spotify-widget-progress-bar">
                                        <div
                                            className="spotify-widget-progress-fill"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <div className="spotify-widget-time">
                                        <span>{formatTime(currentProgress)}</span>
                                        <span>{formatTime(displayData.durationMs)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Minimized View */}
                <div
                    className="spotify-widget-min-view"
                    title="Currently listening to Spotify. Click to expand."
                >
                    <div className="spotify-widget-container min-container">
                        <div className="spotify-widget-drag-handle">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--color-accent)">
                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.45 17.348c-.201.332-.63.438-.962.237-2.637-1.61-5.94-1.976-9.84-.108-.372.178-.813.018-.99-.355-.177-.373-.018-.813.355-.99 4.28-2.052 7.94-1.636 10.865.153.333.203.44.632.237.962zm1.388-3.094c-.255.42-.792.56-1.213.305-3.018-1.85-7.61-2.4-10.74-1.314-.467.162-.97-.087-1.134-.555-.163-.466.088-.97.556-1.133 3.633-1.262 8.73-.637 12.227 1.512.422.256.561.793.305 1.217zm.11-3.237C15.26 8.814 8.868 8.59 5.165 9.714c-.55.166-1.127-.145-1.293-.695-.165-.55.146-1.127.696-1.293 4.267-1.29 11.36-1.023 15.655 1.527.49.29.652.92.36 1.41-.29.492-.92.653-1.41.36z" />
                            </svg>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
