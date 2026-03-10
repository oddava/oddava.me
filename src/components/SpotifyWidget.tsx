import React, { useEffect, useState } from 'react';
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

    if (loading || !data.isPlaying) {
        return null;
    }

    return (
        <a
            href={data.songUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="spotify-widget-container"
            title="Listening on Spotify"
        >
            <svg
                className="spotify-widget-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
            </svg>
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
        </a >
    );
}
