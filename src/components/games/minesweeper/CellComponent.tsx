import type { Cell } from './types';

interface CellComponentProps {
    cell: Cell;
    onClick: () => void;
    onRightClick: (e: React.MouseEvent) => void;
}

export function CellComponent({ cell, onClick, onRightClick }: CellComponentProps) {
    const getContent = () => {
        if (cell.isFlagged) return '🚩';
        if (!cell.isRevealed) return '';
        if (cell.isMine) return '💣';
        if (cell.neighborMines === 0) return '';
        return cell.neighborMines;
    };

    const getClassName = () => {
        const base = 'cell';
        if (cell.isRevealed) {
            if (cell.isMine) return `${base} mine`;
            return `${base} revealed`;
        }
        if (cell.isFlagged) return `${base} flagged`;
        return `${base} hidden`;
    };

    return (
        <button
            className={getClassName()}
            onClick={onClick}
            onContextMenu={onRightClick}
            onAuxClick={(e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    onRightClick(e);
                }
            }}
        >
            {getContent()}
        </button>
    );
}
