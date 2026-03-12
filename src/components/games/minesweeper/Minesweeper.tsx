/** @jsxImportSource react */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Cell, GameStatus } from './types';
import { createBoard, floodFill, chord, getNeighbors, checkWin, formatTime } from './logic';
import { DIFFICULTIES } from './types';

interface MinesweeperProps {
    initialDifficulty?: keyof typeof DIFFICULTIES;
}

interface LeaderboardEntry {
    time: number;
    createdAt: string;
}

export function Minesweeper({ initialDifficulty = 'easy' }: MinesweeperProps) {
    const [difficulty, setDifficulty] = useState<keyof typeof DIFFICULTIES>(initialDifficulty);
    const config = DIFFICULTIES[difficulty];
    const { rows, cols, mines } = config;

    const [board, setBoard] = useState<Cell[]>([]);
    const [status, setStatus] = useState<GameStatus>('idle');
    const [timer, setTimer] = useState(0);
    const [flags, setFlags] = useState(0);
    const [explodedCell, setExplodedCell] = useState<number | null>(null);
    const [showAllMines, setShowAllMines] = useState(false);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(true);
    const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
    const submittedRef = useRef(false);
    const activeDifficultyRef = useRef<keyof typeof DIFFICULTIES>(difficulty);

    // Cells to highlight as chord preview: unrevealed, unflagged neighbors of
    // the hovered cell — but only when that cell is a revealed number and
    // its flagged-neighbor count matches its value (i.e. chord is ready).
    const chordPreviewCells = useMemo<Set<number>>(() => {
        if (hoveredIndex === null || board.length === 0) return new Set();
        const cell = board[hoveredIndex];
        if (!cell?.isRevealed || cell.isMine || cell.neighborMines === 0) return new Set();
        const neighbors = getNeighbors(hoveredIndex, rows, cols);
        const flaggedCount = neighbors.filter((i) => board[i].isFlagged).length;
        if (flaggedCount !== cell.neighborMines) return new Set();
        return new Set(neighbors.filter((i) => !board[i].isRevealed && !board[i].isFlagged));
    }, [hoveredIndex, board, rows, cols]);

    const resetGame = () => {
        setBoard([]);
        setStatus('idle');
        setTimer(0);
        setFlags(0);
        setExplodedCell(null);
        setShowAllMines(false);
        setHoveredIndex(null);
        submittedRef.current = false;
        activeDifficultyRef.current = difficulty;
    };

    const loadLeaderboard = useCallback(async (level: keyof typeof DIFFICULTIES) => {
        try {
            setLeaderboardLoading(true);
            const response = await fetch(`/api/minesweeper-leaderboard?difficulty=${level}`, {
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('Failed to load leaderboard');
            const data = (await response.json()) as { entries: LeaderboardEntry[] };
            setLeaderboard(data.entries ?? []);
            setLeaderboardError(null);
        } catch {
            setLeaderboardError('Could not load leaderboard.');
        } finally {
            setLeaderboardLoading(false);
        }
    }, []);

    const submitScore = useCallback(async (level: keyof typeof DIFFICULTIES, time: number) => {
        try {
            const response = await fetch('/api/minesweeper-leaderboard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ difficulty: level, time }),
            });
            if (!response.ok) throw new Error('Failed to submit');
            const data = (await response.json()) as { entries: LeaderboardEntry[] };
            setLeaderboard(data.entries ?? []);
            setLeaderboardError(null);
        } catch {
            setLeaderboardError('Could not submit score.');
        }
    }, []);

    useEffect(() => {
        resetGame();
    }, [difficulty]);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (status === 'playing') {
            interval = setInterval(() => {
                setTimer((t) => t + 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        loadLeaderboard(difficulty);
    }, [difficulty, loadLeaderboard]);

    useEffect(() => {
        if (status !== 'won' || timer <= 0 || submittedRef.current) return;
        submittedRef.current = true;
        submitScore(activeDifficultyRef.current, timer);
    }, [status, timer, submitScore]);

    const handleCellClick = useCallback(
        (index: number) => {
            if (status === 'won' || status === 'lost') return;

            let newBoard = [...board];

            if (status === 'idle') {
                activeDifficultyRef.current = difficulty;
                newBoard = createBoard(rows, cols, mines, index);
                setStatus('playing');
            }

            const cell = newBoard[index];
            if (cell.isFlagged) return;

            // Chord: clicking a revealed number attempts to open its safe neighbors
            if (cell.isRevealed) {
                const result = chord(newBoard, index, rows, cols);
                if (!result) return; // conditions not met, no-op

                if (result.hitMine) {
                    const minesToReveal = result.board
                        .map((c, idx) => (c.isMine && idx !== result.mineIndex ? idx : -1))
                        .filter((idx) => idx !== -1);
                    setBoard(result.board);
                    setExplodedCell(result.mineIndex);
                    setStatus('lost');
                    setTimeout(() => {
                        setShowAllMines(true);
                        const finalBoard = [...result.board];
                        minesToReveal.forEach((idx) => {
                            finalBoard[idx] = { ...finalBoard[idx], isRevealed: true };
                        });
                        setBoard(finalBoard);
                    }, 600);
                    return;
                }

                setBoard(result.board);
                if (checkWin(result.board)) setStatus('won');
                return;
            }

            if (cell.isMine) {
                newBoard[index] = { ...cell, isRevealed: true };
                const minesToReveal = newBoard
                    .map((c, idx) => (c.isMine && idx !== index ? idx : -1))
                    .filter((idx) => idx !== -1);
                setBoard(newBoard);
                setExplodedCell(index);
                setStatus('lost');
                setTimeout(() => {
                    setShowAllMines(true);
                    const finalBoard = [...newBoard];
                    minesToReveal.forEach((idx) => {
                        finalBoard[idx] = { ...finalBoard[idx], isRevealed: true };
                    });
                    setBoard(finalBoard);
                }, 600);
                return;
            }

            newBoard = floodFill(newBoard, index, rows, cols);
            setBoard(newBoard);

            if (checkWin(newBoard)) {
                setStatus('won');
            }
        },
        [board, status, rows, cols, mines],
    );

    const handleRightClick = useCallback(
        (e: React.MouseEvent, index: number) => {
            e.preventDefault();
            if (status === 'won' || status === 'lost') return;
            if (status === 'idle') return;

            const cell = board[index];
            if (cell.isRevealed) return;

            const newBoard = [...board];
            newBoard[index] = { ...cell, isFlagged: !cell.isFlagged };
            setBoard(newBoard);
            setFlags((f) => (cell.isFlagged ? f - 1 : f + 1));
        },
        [board, status],
    );

    const getCellClassName = (cell: Cell | null, index: number) => {
        if (!cell) return 'cell hidden';
        if (cell.isRevealed) {
            if (cell.isMine) {
                if (index === explodedCell) return 'cell mine exploded';
                if (showAllMines) return 'cell mine revealed-lost';
                return 'cell mine';
            }
            return 'cell revealed';
        }
        if (cell.isFlagged) return 'cell flagged';
        return 'cell hidden';
    };

    const getCellContent = (cell: Cell | null) => {
        if (!cell) return '';
        if (cell.isFlagged && !cell.isRevealed) return '🚩';
        if (cell.isRevealed) {
            if (cell.isMine) {
                return <img src="/images/games/bomb.png" alt="mine" width={20} height={20} />;
            }
            if (cell.neighborMines === 0) return '';
            return cell.neighborMines;
        }
        return '';
    };

    return (
        <div className="minesweeper-wrapper">
            <p className="minesweeper__lead">
                I'm addicted to this game lol.
            </p>
            <div className="leaderboard">
                <div className="leaderboard__head">
                    <span>best times</span>
                    <span>{difficulty}</span>
                </div>
                {leaderboardLoading && <p className="leaderboard__empty">Loading leaderboard...</p>}
                {!leaderboardLoading && leaderboard.length === 0 && (
                    <p className="leaderboard__empty">No times yet.</p>
                )}
                {!leaderboardLoading && leaderboard.length > 0 && (
                    <ol className="leaderboard__list">
                        {leaderboard.map((entry, index) => (
                            <li key={`${entry.createdAt}-${index}`}>
                                <span className="leaderboard__rank">#{index + 1}</span>
                                <span className="leaderboard__time">{formatTime(entry.time)}</span>
                            </li>
                        ))}
                    </ol>
                )}
                {leaderboardError && <p className="leaderboard__error">{leaderboardError}</p>}
            </div>
            <div className="difficulty-selector">
                {(Object.keys(DIFFICULTIES) as Array<keyof typeof DIFFICULTIES>).map((level) => (
                    <button
                        key={level}
                        className={`difficulty-btn ${difficulty === level ? 'active' : ''}`}
                        onClick={() => setDifficulty(level)}
                    >
                        {level}
                    </button>
                ))}
            </div>

            <div className="game-stats">
                <div className="stat-item">
                    <span className="stat-label">flags</span>
                    <span className="stat-value">{mines - flags}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">time</span>
                    <span className="stat-value">{formatTime(timer)}</span>
                </div>
            </div>

            <div className="board-wrapper">
                <div
                    className={`board-grid ${status === 'lost' ? 'game-over' : ''}`}
                    style={{
                        gridTemplateColumns: `repeat(${cols}, 28px)`,
                        gridTemplateRows: `repeat(${rows}, 28px)`,
                    }}
                >
                    {board.length === 0
                        ? Array.from({ length: rows * cols }).map((_, i) => (
                            <button
                                key={i}
                                className="cell hidden"
                                onClick={() => handleCellClick(i)}
                                onContextMenu={(e) => handleRightClick(e, i)}
                            />
                        ))
                        : board.map((cell, i) => (
                            <button
                                key={i}
                                className={`${getCellClassName(cell, i)}${chordPreviewCells.has(i) ? ' chord-preview' : ''}`}
                                data-mines={cell.isRevealed && !cell.isMine && cell.neighborMines > 0 ? cell.neighborMines : undefined}
                                style={showAllMines && cell.isMine && i !== explodedCell ? { '--reveal-delay': `${(i % cols) * 0.05 + Math.floor(i / cols) * 0.03}s` } as React.CSSProperties : undefined}
                                onClick={() => handleCellClick(i)}
                                onContextMenu={(e) => handleRightClick(e, i)}
                                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); handleCellClick(i); } }}
                                onMouseEnter={() => setHoveredIndex(i)}
                                onMouseLeave={() => setHoveredIndex(null)}
                            >
                                {getCellContent(cell)}
                            </button>
                        ))}
                </div>
            </div>

            {(status === 'won' || status === 'lost') && (
                <div className="game-end-controls">
                    <div className={`game-message ${status}`}>
                        {status === 'won' ? 'well done!' : 'game over'}
                    </div>
                    <button className="restart-btn" onClick={resetGame}>
                        restart
                    </button>
                </div>
            )}
        </div>
    );
}
