// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// In‑memory leaderboard: { playerName: winCount }
let leaderboard = {};

// Winning combinations for Tic Tac Toe
const winningCombos = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

// Check if there is a winner or a draw
function checkWinner(board) {
  for (const combo of winningCombos) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every(cell => cell !== null)) {
    return 'draw';
  }
  return null;
}

// Create a new game state for a room.
// If isAIGame is true, then only one human player will join and the AI will be added.
function createNewGameState(isAIGame = false) {
  const game = {
    board: Array(9).fill(null),
    players: {}, // Mapping: socket.id => { symbol, name, isAI }
    currentTurn: 'X',
    gameOver: false,
    winner: null,
    isAIGame: isAIGame
  };
  return game;
}

// Reset an existing game state (keeping the players)
function resetGameState(game) {
  game.board = Array(9).fill(null);
  game.currentTurn = 'X';
  game.gameOver = false;
  game.winner = null;
}

// Emit the current game state to everyone in a room
function emitGameState(room) {
  if (rooms[room]) {
    io.to(room).emit('gameState', rooms[room]);
  }
}

// -------------------------------------------
// AI Opponent: Minimax Algorithm Implementation
// -------------------------------------------
function minimax(board, depth, isMaximizing, aiSymbol, humanSymbol) {
  const result = checkWinner(board);
  if (result !== null) {
    if (result === aiSymbol) return 10 - depth;
    else if (result === humanSymbol) return depth - 10;
    else if (result === 'draw') return 0;
  }
  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let i = 0; i < board.length; i++) {
      if (!board[i]) {
        board[i] = aiSymbol;
        let score = minimax(board, depth + 1, false, aiSymbol, humanSymbol);
        board[i] = null;
        bestScore = Math.max(score, bestScore);
      }
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (let i = 0; i < board.length; i++) {
      if (!board[i]) {
        board[i] = humanSymbol;
        let score = minimax(board, depth + 1, true, aiSymbol, humanSymbol);
        board[i] = null;
        bestScore = Math.min(score, bestScore);
      }
    }
    return bestScore;
  }
}

function computeAIMove(board, aiSymbol) {
  const humanSymbol = aiSymbol === 'X' ? 'O' : 'X';
  let bestScore = -Infinity;
  let move = -1;
  for (let i = 0; i < board.length; i++) {
    if (!board[i]) {
      board[i] = aiSymbol;
      let score = minimax(board, 0, false, aiSymbol, humanSymbol);
      board[i] = null;
      if (score > bestScore) {
        bestScore = score;
        move = i;
      }
    }
  }
  return move;
}
// -------------------------------------------

// Rooms: mapping room name to game state object
const rooms = {};

// API endpoint to get the leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboard);
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  // Client emits joinRoom with: { room, name, gameType }
  // gameType is either 'multiplayer' or 'ai'
  socket.on('joinRoom', (data) => {
    const { room, name, gameType } = data;
    socket.join(room);
    socket.room = room; // Store the room name on the socket

    // Create the room if it doesn't exist yet
    if (!rooms[room]) {
      rooms[room] = createNewGameState(gameType === 'ai');
    }
    const game = rooms[room];

    // Assign role and symbol
    let role = 'spectator';
    let symbol = null;
    
    if (game.isAIGame) {
      // For AI games, only one human is allowed.
      const humanCount = Object.values(game.players).filter(p => !p.isAI && p.symbol).length;
      if (humanCount < 1) {
        symbol = 'X'; // Human always gets X; AI gets O.
        game.players[socket.id] = { symbol, name, isAI: false };
        role = 'player';
        // Add the AI player if not already present.
        if (!Object.values(game.players).some(p => p.isAI)) {
          game.players['AI'] = { symbol: 'O', name: 'Computer', isAI: true };
        }
      } else {
        game.players[socket.id] = { symbol: null, name, isAI: false };
      }
    } else {
      // Multiplayer: allow only 2 players.
      const playerCount = Object.values(game.players).filter(p => p.symbol).length;
      if (playerCount < 2) {
        symbol = playerCount === 0 ? 'X' : 'O';
        game.players[socket.id] = { symbol, name, isAI: false };
        role = 'player';
      } else {
        game.players[socket.id] = { symbol: null, name, isAI: false };
      }
    }
    
    // Inform the client of their assignment and send the game state.
    socket.emit('assign', { role, symbol, name, room, gameType });
    socket.emit('gameState', game);
    io.to(room).emit('message', `${name} has joined as ${role}${symbol ? ' (' + symbol + ')' : ''}.`);
  });
  
  // Handle move events from players
  socket.on('move', (index) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;
    const game = rooms[room];
    
    if (game.gameOver) {
      socket.emit('message', 'Game is over. Please restart to play again.');
      return;
    }
    
    // Make sure the socket is a player with a symbol.
    if (!game.players[socket.id] || !game.players[socket.id].symbol) {
      socket.emit('message', 'You are not a player.');
      return;
    }
    
    const playerSymbol = game.players[socket.id].symbol;
    if (playerSymbol !== game.currentTurn) {
      socket.emit('message', 'Not your turn.');
      return;
    }
    
    if (index < 0 || index > 8 || game.board[index]) {
      socket.emit('message', 'Invalid move.');
      return;
    }
    
    // Record the move.
    game.board[index] = playerSymbol;
    
    // Check for a win or draw.
    const result = checkWinner(game.board);
    if (result) {
      game.gameOver = true;
      game.winner = result;
      // Update leaderboard if there’s a winner (and not a draw).
      if (result !== 'draw') {
        // For multiplayer, find the winning human player's name.
        let winnerName = null;
        for (let key in game.players) {
          if (game.players[key].symbol === result && !game.players[key].isAI) {
            winnerName = game.players[key].name;
            break;
          }
        }
        if (winnerName) {
          leaderboard[winnerName] = (leaderboard[winnerName] || 0) + 1;
        }
      }
    } else {
      game.currentTurn = game.currentTurn === 'X' ? 'O' : 'X';
    }
    
    emitGameState(room);
    
    // If this is an AI game and it's now the AI's turn, compute and apply the AI move.
    if (game.isAIGame && !game.gameOver && game.currentTurn === game.players['AI'].symbol) {
      setTimeout(() => {
        const aiMove = computeAIMove(game.board, game.players['AI'].symbol);
        if (aiMove !== -1) {
          game.board[aiMove] = game.players['AI'].symbol;
          const resultAfterAI = checkWinner(game.board);
          if (resultAfterAI) {
            game.gameOver = true;
            game.winner = resultAfterAI;
            if (resultAfterAI !== 'draw') {
              // Update leaderboard if the human wins.
              let humanKey = Object.keys(game.players).find(key => key !== 'AI');
              if (game.players[humanKey].symbol === resultAfterAI) {
                let winnerName = game.players[humanKey].name;
                leaderboard[winnerName] = (leaderboard[winnerName] || 0) + 1;
              }
            }
          } else {
            // Switch back to the human player's turn.
            let humanKey = Object.keys(game.players).find(key => key !== 'AI');
            game.currentTurn = game.players[humanKey].symbol;
          }
          emitGameState(room);
        }
      }, 500);
    }
  });
  
  // Chat message handling
  socket.on('chatMessage', (msg) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;
    const player = rooms[room].players[socket.id];
    const name = player ? player.name : "Spectator";
    io.to(room).emit('chatMessage', { name, msg });
  });
  
  // Restart game event
  socket.on('restart', () => {
    const room = socket.room;
    if (!room || !rooms[room]) return;
    const game = rooms[room];
    if (!game.gameOver) {
      socket.emit('message', 'Game is not over yet.');
      return;
    }
    resetGameState(game);
    io.to(room).emit('message', 'Game has been restarted!');
    emitGameState(room);
  });
  
  // On disconnect: remove the player and reset the game
  socket.on('disconnect', () => {
    const room = socket.room;
    if (room && rooms[room]) {
      const player = rooms[room].players[socket.id];
      const name = player ? player.name : "A user";
      delete rooms[room].players[socket.id];
      io.to(room).emit('message', `${name} has disconnected. Game will reset.`);
      resetGameState(rooms[room]);
      emitGameState(room);
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
