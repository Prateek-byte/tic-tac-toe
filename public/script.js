// public/script.js
const socket = io();

let mySymbol = null;
let myRole = null;
let gameState = {};
let myName = '';
let currentRoom = '';
let gameType = 'multiplayer';

// DOM Elements
const joinModal = document.getElementById('joinModal');
const joinBtn = document.getElementById('joinBtn');
const playerNameInput = document.getElementById('playerName');
const roomNameInput = document.getElementById('roomName');
const gameTypeRadios = document.getElementsByName('gameType');

const gameContainer = document.getElementById('gameContainer');
const statusDiv = document.getElementById('status');
const boardDiv = document.getElementById('board');
const restartBtn = document.getElementById('restartBtn');

const chatMessagesDiv = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

const leaderboardList = document.getElementById('leaderboardList');

const toastContainer = document.getElementById('toast');

// Handle joining a room
joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  let room = roomNameInput.value.trim();
  // Determine game type from radio buttons
  for (let radio of gameTypeRadios) {
    if (radio.checked) {
      gameType = radio.value;
      break;
    }
  }
  if (!name) {
    showToast("Please enter your name.");
    return;
  }
  if (gameType === 'multiplayer' && !room) {
    showToast("Please enter a room name for multiplayer.");
    return;
  }
  if (gameType === 'ai') {
    // For AI games, use a unique room name (e.g., "ai-" + name)
    room = "ai-" + name;
  }
  myName = name;
  currentRoom = room;
  
  socket.emit('joinRoom', { room, name, gameType });
  joinModal.style.display = 'none';
  gameContainer.style.display = 'block';
});

// Handle board cell clicks
boardDiv.addEventListener('click', (e) => {
  if (e.target.classList.contains('cell')) {
    const index = e.target.getAttribute('data-index');
    if (myRole !== 'player') {
      showToast('You are a spectator. Wait for a game to start.');
      return;
    }
    if (gameState.currentTurn !== mySymbol) {
      showToast("It's not your turn.");
      return;
    }
    if (e.target.textContent !== '') {
      showToast("Cell already taken.");
      return;
    }
    socket.emit('move', parseInt(index));
  }
});

// Restart game event
restartBtn.addEventListener('click', () => {
  socket.emit('restart');
  fetchLeaderboard();
});

// Chat: send message events
sendChatBtn.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (message) {
    socket.emit('chatMessage', message);
    chatInput.value = '';
  }
});
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatBtn.click();
  }
});

// Socket events
socket.on('assign', (data) => {
  myRole = data.role;
  mySymbol = data.symbol;
  showToast(`You are ${myRole}${mySymbol ? ' (' + mySymbol + ')' : ''}.`);
});
socket.on('gameState', (state) => {
  gameState = state;
  updateBoard();
  updateStatus();
});
socket.on('message', (msg) => {
  showToast(msg);
});
socket.on('chatMessage', (data) => {
  addChatMessage(data.name, data.msg);
});

// Update the board UI based on game state
function updateBoard() {
  const cells = document.querySelectorAll('.cell');
  cells.forEach(cell => {
    const index = cell.getAttribute('data-index');
    const cellValue = gameState.board[index];
    cell.textContent = cellValue ? cellValue : '';
    if (cellValue) cell.classList.add('filled');
    else cell.classList.remove('filled');
  });
}

// Update status text (turn info, game result)
function updateStatus() {
  if (gameState.gameOver) {
    if (gameState.winner === 'draw') {
      statusDiv.textContent = "Game over! It's a draw.";
    } else {
      statusDiv.textContent = `Game over! Winner is ${gameState.winner}.`;
    }
    fetchLeaderboard();
  } else {
    statusDiv.textContent = `Current turn: ${gameState.currentTurn}`;
  }
}

// Show toast notifications
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// Add a chat message to the chat area
function addChatMessage(name, message) {
  const p = document.createElement('p');
  p.innerHTML = `<strong>${name}:</strong> ${message}`;
  chatMessagesDiv.appendChild(p);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Fetch and display leaderboard data from the server
function fetchLeaderboard() {
  fetch('/api/leaderboard')
    .then(response => response.json())
    .then(data => {
      leaderboardList.innerHTML = '';
      const entries = Object.entries(data);
      entries.sort((a, b) => b[1] - a[1]);
      entries.forEach(([name, wins]) => {
        const li = document.createElement('li');
        li.textContent = `${name}: ${wins} wins`;
        leaderboardList.appendChild(li);
      });
    })
    .catch(err => console.error('Error fetching leaderboard:', err));
}

// Fetch the leaderboard initially
fetchLeaderboard();
