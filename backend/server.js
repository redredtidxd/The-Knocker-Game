const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const questionsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

let games = [];
let users = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getRandomQuestion(level) {
  const levelQuestions = questionsData.levels[level];
  return levelQuestions[Math.floor(Math.random() * levelQuestions.length)];
}

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  users[socket.id] = { id: socket.id };

  socket.emit('gameList', games.filter(g => g.players.length < 2));

  socket.on('createGame', (data) => {
    const roomCode = generateRoomCode();
    const game = {
      id: roomCode,
      mode: data.mode,
      host: socket.id,
      players: [socket.id],
      currentLevel: 1,
      currentTurn: 0,
      currentQuestion: null,
      isPlaying: false
    };
    games.push(game);
    socket.join(roomCode);
    users[socket.id].gameId = roomCode;
    users[socket.id].name = data.name;
    socket.emit('gameCreated', game);
    io.emit('gameList', games.filter(g => g.players.length < 2));
  });

  socket.on('joinGame', (data) => {
    const game = games.find(g => g.id === data.gameId);
    if (game && game.players.length < 2) {
      game.players.push(socket.id);
      socket.join(data.gameId);
      users[socket.id].gameId = data.gameId;
      users[socket.id].name = data.name;
      
      if (game.players.length === 2) {
        game.isPlaying = true;
        game.currentQuestion = getRandomQuestion(game.currentLevel);
        io.to(data.gameId).emit('gameStarted', {
          game,
          players: [
            { id: game.players[0], name: users[game.players[0]].name },
            { id: game.players[1], name: users[game.players[1]].name }
          ]
        });
      } else {
        socket.emit('joinedGame', game);
      }
      io.emit('gameList', games.filter(g => g.players.length < 2));
    } else {
      socket.emit('joinError', 'La sala no existe o está llena');
    }
  });

  socket.on('nextTurn', () => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    if (game) {
      game.currentTurn = (game.currentTurn + 1) % 2;
      
      if (game.currentTurn === 0) {
        game.currentLevel = Math.min(3, game.currentLevel + 1);
      }
      
      game.currentQuestion = getRandomQuestion(game.currentLevel);
      io.to(gameId).emit('turnChanged', game);
    }
  });

  socket.on('leaveGame', () => {
    const gameId = users[socket.id].gameId;
    if (gameId) {
      const gameIndex = games.findIndex(g => g.id === gameId);
      if (gameIndex !== -1) {
        const game = games[gameIndex];
        game.players = game.players.filter(p => p !== socket.id);
        if (game.players.length === 0) {
          games.splice(gameIndex, 1);
        } else {
          io.to(gameId).emit('playerLeft');
        }
        io.emit('gameList', games.filter(g => g.players.length < 2));
      }
      delete users[socket.id].gameId;
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    const gameId = users[socket.id]?.gameId;
    if (gameId) {
      const gameIndex = games.findIndex(g => g.id === gameId);
      if (gameIndex !== -1) {
        const game = games[gameIndex];
        game.players = game.players.filter(p => p !== socket.id);
        if (game.players.length === 0) {
          games.splice(gameIndex, 1);
        } else {
          io.to(gameId).emit('playerLeft');
        }
        io.emit('gameList', games.filter(g => g.players.length < 2));
      }
    }
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
