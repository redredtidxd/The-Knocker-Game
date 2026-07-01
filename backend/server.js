const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
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

function getRandomQuestion(mode, level, usedQuestions) {
  const questions = questionsData[mode]?.[level];
  if (!questions) return null;
  
  const availableQuestions = questions.filter(q => !usedQuestions.includes(q));
  if (availableQuestions.length === 0) return null;
  
  return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
}

io.on('connection', (socket) => {
  console.log('✅ Nuevo usuario conectado:', socket.id);
  console.log('   Handshake:', socket.handshake.headers.origin);

  users[socket.id] = { id: socket.id };
  socket.emit('gameList', games.filter(g => g.players.length < 2));

  socket.on('createGame', (data) => {
    const roomCode = generateRoomCode();
    const game = {
      id: roomCode,
      mode: data.mode,
      inputType: data.inputType || 'text',
      host: socket.id,
      players: [socket.id],
      currentLevel: 1,
      currentRound: 1,
      maxRounds: 5,
      maxLevels: 3,
      questions: {},
      answers: {},
      usedQuestions: [],
      isPlaying: false,
      roundHistory: [],
      isTyping: {},
      skips: {
        [socket.id]: 2 // 2 skips per player
      }
    };
    games.push(game);
    socket.join(roomCode);
    users[socket.id].gameId = roomCode;
    users[socket.id].name = data.name;
    socket.emit('gameCreated', game);
    io.emit('gameList', games.filter(g => g.players.length < 2));
  });

  socket.on('joinGame', (data) => {
    console.log('🔄 Intentando unirse a partida:', data.gameId);
    const game = games.find(g => g.id === data.gameId);
    
    if (game) {
      console.log('   Partida encontrada:', game.id, 'Jugadores:', game.players.length);
    } else {
      console.log('   ❌ Partida NO encontrada:', data.gameId);
    }
    
    if (game && game.players.length < 2) {
      game.players.push(socket.id);
      game.skips[socket.id] = 2; // Give 2 skips to new player
      socket.join(data.gameId);
      users[socket.id].gameId = data.gameId;
      users[socket.id].name = data.name;
      
      console.log('   ✅ Jugador', data.name, 'se unió a la partida', data.gameId);
      
      if (game.players.length === 2) {
        game.isPlaying = true;
        // Asignar preguntas iniciales
        const q1 = getRandomQuestion(game.mode, game.currentLevel, game.usedQuestions);
        const q2 = getRandomQuestion(game.mode, game.currentLevel, [...game.usedQuestions, q1]);
        game.questions[game.players[0]] = q1;
        game.questions[game.players[1]] = q2;
        game.usedQuestions.push(q1, q2);
        
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
      const errorMsg = game ? 'La sala está llena' : 'La sala no existe';
      console.log('   ❌ Error al unirse:', errorMsg);
      socket.emit('joinError', errorMsg);
    }
  });

  socket.on('typing', (isTyping) => {
    const gameId = users[socket.id].gameId;
    if (!gameId) return;
    const game = games.find(g => g.id === gameId);
    if (!game) return;
    
    game.isTyping[socket.id] = isTyping;
    socket.to(gameId).emit('playerTyping', { 
      playerId: socket.id, 
      isTyping 
    });
  });

  socket.on('skipQuestion', () => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    if (!game) return;
    
    if (game.skips[socket.id] <= 0) {
      socket.emit('noSkipsLeft');
      return;
    }
    
    game.skips[socket.id]--;
    
    // Get new question for this player
    const newQuestion = getRandomQuestion(game.mode, game.currentLevel, game.usedQuestions);
    if (newQuestion) {
      // Remove old question from used questions if it exists
      game.usedQuestions = game.usedQuestions.filter(q => q !== game.questions[socket.id]);
      game.questions[socket.id] = newQuestion;
      game.usedQuestions.push(newQuestion);
    }
    
    io.to(gameId).emit('questionSkipped', {
      playerId: socket.id,
      skipsLeft: game.skips[socket.id],
      game
    });
  });

  socket.on('submitAnswer', (data) => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    
    if (!game) return;
    
    console.log('📝 Respuesta recibida de', users[socket.id].name);
    
    game.answers[socket.id] = {
      text: data.answer,
      audio: data.audioData || null,
      isAudio: data.isAudio || false
    };
    
    // Verificar si ambos han respondido
    const player1 = game.players[0];
    const player2 = game.players[1];
    
    if (game.answers[player1] && game.answers[player2]) {
      // Guardar esta ronda en el historial
      game.roundHistory.push({
        round: game.currentRound,
        level: game.currentLevel,
        questions: {
          [player1]: game.questions[player1],
          [player2]: game.questions[player2]
        },
        answers: {
          [player1]: game.answers[player1],
          [player2]: game.answers[player2]
        }
      });
      
      // Emitir que ambos respondieron
      io.to(gameId).emit('roundAnswers', {
        answers: {
          [player1]: { name: users[player1].name, answer: game.answers[player1] },
          [player2]: { name: users[player2].name, answer: game.answers[player2] }
        },
        questions: {
          [player1]: game.questions[player1],
          [player2]: game.questions[player2]
        }
      });
    }
  });

  socket.on('continueNextRound', () => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    
    if (!game) return;
    
    console.log('Continuing to next round. Current:', game.currentLevel, game.currentRound);
    
    // Siguiente ronda o nivel
    game.currentRound++;
    game.answers = {};
    game.isTyping = {}; // Reset typing status
    
    if (game.currentRound > game.maxRounds) {
      game.currentLevel++;
      game.currentRound = 1;
      
      if (game.currentLevel > game.maxLevels) {
        console.log('Game over!');
        io.to(gameId).emit('gameOver', game);
        return;
      }
    }
    
    console.log('New:', game.currentLevel, game.currentRound);
    
    // Nuevas preguntas
    const player1 = game.players[0];
    const player2 = game.players[1];
    const q1 = getRandomQuestion(game.mode, game.currentLevel, game.usedQuestions);
    const q2 = getRandomQuestion(game.mode, game.currentLevel, [...game.usedQuestions, q1]);
    game.questions[player1] = q1;
    game.questions[player2] = q2;
    game.usedQuestions.push(q1, q2);
    
    console.log('Emitting nextRound with game:', game);
    io.to(gameId).emit('nextRound', game);
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
          io.to(gameId).emit('playerLeft', { 
            playerName: users[socket.id].name 
          });
        }
        io.emit('gameList', games.filter(g => g.players.length < 2));
      }
      delete users[socket.id].gameId;
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado:', socket.id);
    const gameId = users[socket.id]?.gameId;
    if (gameId) {
      const gameIndex = games.findIndex(g => g.id === gameId);
      if (gameIndex !== -1) {
        const game = games[gameIndex];
        game.players = game.players.filter(p => p !== socket.id);
        if (game.players.length === 0) {
          games.splice(gameIndex, 1);
        } else {
          io.to(gameId).emit('playerLeft', { 
            playerName: users[socket.id].name 
          });
        }
        io.emit('gameList', games.filter(g => g.players.length < 2));
      }
    }
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en http://0.0.0.0:${PORT}`);
  console.log(`Para acceder desde otra computadora en la misma red, usa tu IP local`);
});
