/**
 * Pure game-logic functions for Minesweeper.
 * No React imports — easy to test independently.
 */
import type { Cell } from './types';

/** Create a flat board array with mines placed randomly. */
export function createBoard(
    rows: number,
    cols: number,
    mines: number,
    safeIndex?: number,
): Cell[] {
    const totalCells = rows * cols;
    const board: Cell[] = [];

    for (let i = 0; i < totalCells; i++) {
        board.push({
            isMine: false,
            isRevealed: false,
            isFlagged: false,
            neighborMines: 0,
        });
    }

    // Collect available indices (excluding safe cell)
    const availableIndices: number[] = [];
    for (let i = 0; i < totalCells; i++) {
        if (i !== safeIndex) {
            availableIndices.push(i);
        }
    }

    // Fisher-Yates shuffle, take first N for mines
    for (let i = availableIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableIndices[i], availableIndices[j]] = [
            availableIndices[j],
            availableIndices[i],
        ];
    }

    for (let i = 0; i < mines && i < availableIndices.length; i++) {
        board[availableIndices[i]].isMine = true;
    }

    // Calculate neighbor counts
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (!board[idx].isMine) {
                let count = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                            if (board[nr * cols + nc].isMine) count++;
                        }
                    }
                }
                board[idx].neighborMines = count;
            }
        }
    }

    return board;
}

/** Iterative flood fill — reveals connected empty cells. */
export function floodFill(
    board: Cell[],
    startIndex: number,
    rows: number,
    cols: number,
): Cell[] {
    const newBoard = [...board];
    const queue: number[] = [startIndex];
    const visited = new Set<number>();

    while (queue.length > 0) {
        const idx = queue.shift()!;
        if (visited.has(idx)) continue;
        visited.add(idx);

        const cell = newBoard[idx];
        if (cell.isRevealed || cell.isFlagged || cell.isMine) continue;

        cell.isRevealed = true;

        if (cell.neighborMines === 0) {
            const r = Math.floor(idx / cols);
            const c = idx % cols;

            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                        const nidx = nr * cols + nc;
                        if (!visited.has(nidx)) {
                            queue.push(nidx);
                        }
                    }
                }
            }
        }
    }

    return newBoard;
}

/**
 * Chording — click a revealed number whose flagged-neighbor count matches it.
 * Returns null if conditions aren't met (no-op), otherwise the result.
 */
export function chord(
    board: Cell[],
    index: number,
    rows: number,
    cols: number,
): { board: Cell[]; hitMine: false } | { board: Cell[]; hitMine: true; mineIndex: number } | null {
    const cell = board[index];
    if (!cell.isRevealed || cell.isMine || cell.neighborMines === 0) return null;

    const r = Math.floor(index / cols);
    const c = index % cols;

    const neighbors: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                neighbors.push(nr * cols + nc);
            }
        }
    }

    const flaggedCount = neighbors.filter((i) => board[i].isFlagged).length;
    if (flaggedCount !== cell.neighborMines) return null; // chord conditions not met

    // Attempt to reveal all unflagged, unrevealed neighbors
    let newBoard = [...board];
    for (const ni of neighbors) {
        const n = newBoard[ni];
        if (n.isRevealed || n.isFlagged) continue;
        if (n.isMine) {
            newBoard[ni] = { ...n, isRevealed: true };
            return { board: newBoard, hitMine: true, mineIndex: ni };
        }
        newBoard = floodFill(newBoard, ni, rows, cols);
    }

    return { board: newBoard, hitMine: false };
}

/** Check if the player has won (all non-mine cells revealed). */
export function checkWin(board: Cell[]): boolean {
    return board.every((cell) => cell.isMine || cell.isRevealed);
}

/** Format seconds into MM:SS display string. */
export function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}