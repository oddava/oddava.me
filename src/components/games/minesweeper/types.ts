/**
 * Minesweeper game types.
 */

export interface Cell {
    isMine: boolean;
    isRevealed: boolean;
    isFlagged: boolean;
    neighborMines: number;
}

export interface GameConfig {
    rows: number;
    cols: number;
    mines: number;
}

export type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

export const DIFFICULTIES: Record<string, GameConfig> = {
    easy: { rows: 9, cols: 9, mines: 10 },
    medium: { rows: 16, cols: 16, mines: 40 },
    hard: { rows: 16, cols: 30, mines: 99 },
};
