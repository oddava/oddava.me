import { describe, expect, it, vi } from 'vitest';
import {
  checkWin,
  chord,
  createBoard,
  floodFill,
  formatTime,
  getNeighbors,
} from '../src/components/games/minesweeper/logic';
import type { Cell } from '../src/components/games/minesweeper/types';

function cell(overrides: Partial<Cell> = {}): Cell {
  return {
    isMine: false,
    isRevealed: false,
    isFlagged: false,
    neighborMines: 0,
    ...overrides,
  };
}

describe('Minesweeper logic', () => {
  it('keeps the first cell and its neighbors mine-free', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const board = createBoard(9, 9, 10, 40);

    expect(board.filter((item) => item.isMine)).toHaveLength(10);
    for (const index of [30, 31, 32, 39, 40, 41, 48, 49, 50]) {
      expect(board[index].isMine).toBe(false);
    }
    vi.restoreAllMocks();
  });

  it('flood fills connected empty cells without revealing mines or flags', () => {
    const board = [
      cell(),
      cell(),
      cell({ isMine: true }),
      cell(),
      cell({ neighborMines: 1 }),
      cell({ isFlagged: true }),
    ];

    const result = floodFill(board, 0, 2, 3);

    expect(board[0].isRevealed).toBe(false);
    expect(result[0].isRevealed).toBe(true);
    expect(result[1].isRevealed).toBe(true);
    expect(result[2].isRevealed).toBe(false);
    expect(result[5].isRevealed).toBe(false);
  });

  it('chords a revealed number only when the flag count matches', () => {
    const board = [
      cell({ isRevealed: true, neighborMines: 1 }),
      cell({ isMine: true, isFlagged: true }),
      cell({ neighborMines: 1 }),
      cell({ neighborMines: 1 }),
    ];

    const result = chord(board, 0, 2, 2);

    expect(result?.hitMine).toBe(false);
    expect(result?.board[2].isRevealed).toBe(true);
    expect(result?.board[3].isRevealed).toBe(true);
  });

  it('reports neighbors, wins, and formatted time correctly', () => {
    expect(getNeighbors(0, 2, 2)).toEqual([1, 2, 3]);
    expect(checkWin([cell({ isRevealed: true }), cell({ isMine: true })])).toBe(
      true,
    );
    expect(formatTime(65)).toBe('01:05');
  });
});
