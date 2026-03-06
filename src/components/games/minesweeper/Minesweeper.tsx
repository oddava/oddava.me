import { useState, useEffect, useCallback } from 'react';
import type { Cell, GameConfig, GameStatus } from './types';
import { createBoard, floodFill, checkWin, formatTime } from './logic';
import { DIFFICULTIES } from './types';

interface MinesweeperProps {
    initialDifficulty?: keyof typeof DIFFICULTIES;
}

export function Minesweeper({ initialDifficulty = 'easy' }: MinesweeperProps) {
    const [difficulty, setDifficulty] = useState<keyof typeof DIFFICULTIES>(initialDifficulty);
    const config = DIFFICULTIES[difficulty];
    const { rows, cols, mines } = config;

    const [board, setBoard] = useState<Cell[]>([]);
    const [status, setStatus] = useState<GameStatus>('idle');
    const [timer, setTimer] = useState(0);
    const [flags, setFlags] = useState(0);

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

    const resetGame = () => {
        setBoard([]);
        setStatus('idle');
        setTimer(0);
        setFlags(0);
    };

    const handleCellClick = useCallback(
        (index: number) => {
            if (status === 'won' || status === 'lost') return;

            let newBoard = [...board];

            if (status === 'idle') {
                newBoard = createBoard(rows, cols, mines, index);
                setStatus('playing');
            }

            const cell = newBoard[index];
            if (cell.isRevealed || cell.isFlagged) return;

            if (cell.isMine) {
                newBoard[index] = { ...cell, isRevealed: true };
                setBoard(newBoard);
                setStatus('lost');
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

    const getCellClassName = (cell: Cell | null) => {
        if (!cell) return 'cell hidden';
        if (cell.isRevealed) {
            if (cell.isMine) return 'cell mine';
            return 'cell revealed';
        }
        if (cell.isFlagged) return 'cell flagged';
        return 'cell hidden';
    };

    const getCellContent = (cell: Cell | null) => {
        if (!cell || !cell.isRevealed) {
            if (cell?.isFlagged) return '🚩';
            return '';
        }
        if (cell.isMine) return '💣';
        if (cell.neighborMines === 0) return '';
        return cell.neighborMines;
    };

    return (
        <div className="minesweeper-wrapper">
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
                    className="board-grid"
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
                                className={getCellClassName(cell)}
                                data-mines={cell.isRevealed && !cell.isMine && cell.neighborMines > 0 ? cell.neighborMines : undefined}
                                onClick={() => handleCellClick(i)}
                                onContextMenu={(e) => handleRightClick(e, i)}
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
