const SIZE = 4;
const WIN_VALUE = 2048;
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const messageEl = document.getElementById('message');
const restartBtn = document.getElementById('restart');

let grid = [];
let score = 0;
let best = Number(localStorage.getItem('ratperaArcadeBest') || 0);
let hasWon = false;
let touchStartX = 0;
let touchStartY = 0;

bestEl.textContent = best;

function buildBoard() {
  boardEl.innerHTML = '';
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('role', 'gridcell');
    cell.dataset.index = i;
    boardEl.appendChild(cell);
  }
}

function initGrid() {
  grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function emptyCells() {
  const cells = [];
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      if (grid[r][c] === 0) {
        cells.push({ r, c });
      }
    }
  }
  return cells;
}

function addRandomTile() {
  const empties = emptyCells();
  if (empties.length === 0) return;
  const { r, c } = empties[Math.floor(Math.random() * empties.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function updateScore(value) {
  score += value;
  scoreEl.textContent = score;
  if (score > best) {
    best = score;
    bestEl.textContent = best;
    localStorage.setItem('ratperaArcadeBest', String(best));
  }
}

function updateBoard() {
  const cells = boardEl.querySelectorAll('.cell');
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const value = grid[r][c];
      const index = r * SIZE + c;
      const cell = cells[index];
      cell.innerHTML = '';
      if (value) {
        const valueDiv = document.createElement('div');
        const classValue = value <= 2048 ? value : 'super';
        valueDiv.className = `cell-value tile-${classValue}`;
        valueDiv.textContent = value;
        cell.appendChild(valueDiv);
      }
    }
  }
}

function rotateGrid(times = 1) {
  for (let t = 0; t < times; t += 1) {
    const newGrid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        newGrid[c][SIZE - 1 - r] = grid[r][c];
      }
    }
    grid = newGrid;
  }
}

function moveLeft() {
  let moved = false;

  for (let r = 0; r < SIZE; r += 1) {
    const row = grid[r].filter(v => v !== 0);
    for (let c = 0; c < row.length - 1; c += 1) {
      if (row[c] === row[c + 1]) {
        row[c] *= 2;
        updateScore(row[c]);
        row.splice(c + 1, 1);
        row.push(0);
      }
    }
    while (row.length < SIZE) {
      row.push(0);
    }
    if (!moved && row.some((value, c) => value !== grid[r][c])) {
      moved = true;
    }
    grid[r] = row;
  }

  return moved;
}

function move(direction) {
  let rotateCount = 0;
  if (direction === 'up') rotateCount = 3;
  if (direction === 'right') rotateCount = 2;
  if (direction === 'down') rotateCount = 1;

  rotateGrid(rotateCount);
  const moved = moveLeft();
  rotateGrid((4 - rotateCount) % 4);

  if (!moved) return false;

  addRandomTile();
  updateBoard();

  if (!hasWon && grid.some(row => row.some(val => val === WIN_VALUE))) {
    hasWon = true;
    messageEl.textContent = 'You made it to 2048! Keep going or start over.';
  } else if (isGameOver()) {
    messageEl.textContent = 'No more moves. Try again!';
  } else {
    messageEl.textContent = '';
  }

  return true;
}

function isGameOver() {
  if (emptyCells().length > 0) return false;
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const value = grid[r][c];
      if (r < SIZE - 1 && grid[r + 1][c] === value) return false;
      if (c < SIZE - 1 && grid[r][c + 1] === value) return false;
    }
  }
  return true;
}

function resetGame() {
  hasWon = false;
  score = 0;
  scoreEl.textContent = '0';
  messageEl.textContent = '';
  initGrid();
  addRandomTile();
  addRandomTile();
  updateBoard();
}

function handleKeydown(event) {
  const keyMap = {
    ArrowUp: 'up',
    ArrowRight: 'right',
    ArrowDown: 'down',
    ArrowLeft: 'left'
  };
  const direction = keyMap[event.key];
  if (!direction) return;
  event.preventDefault();
  move(direction);
}

function handleTouchStart(event) {
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

function handleTouchEnd(event) {
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const threshold = 24;

  if (Math.max(absX, absY) < threshold) return;

  if (absX > absY) {
    move(dx > 0 ? 'right' : 'left');
  } else {
    move(dy > 0 ? 'down' : 'up');
  }
}

restartBtn.addEventListener('click', resetGame);
window.addEventListener('keydown', handleKeydown, { passive: false });
boardEl.addEventListener('touchstart', handleTouchStart, { passive: true });
boardEl.addEventListener('touchend', handleTouchEnd, { passive: true });

buildBoard();
resetGame();
