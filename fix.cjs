const fs = require('fs');
const file = 'src/components/games/minesweeper/Minesweeper.tsx';
let content = fs.readFileSync(file, 'utf8');

const replacement = `<div className="game-stats">
                <div className="stat-left">
                    <span className="stat-emoji">{getStatusEmoji()}</span>
                </div>
                <div className="stat-center">
                    <div className="stat-item">
                        <span className="stat-label">flags</span>
                        <span className="stat-value">{mines - flags}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">time</span>
                        <span className="stat-value">{formatTime(timer)}</span>
                    </div>
                </div>
                <div className="stat-right">
                    <button className="restart-btn" onClick={resetGame}>
                        restart
                    </button>
                </div>
            </div>`;

content = content.replace(/<div className="game-stats">[\s\S]*?<\/div>\s*<div className="board-wrapper">/, replacement + '\n\n            <div className="board-wrapper">');

fs.writeFileSync(file, content);
