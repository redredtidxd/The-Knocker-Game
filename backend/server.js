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

function getRandomQuestion(mode, level, usedQuestions, submode = null, mazo = null) {
  let questions = [];
  
  if (mazo) {
    questions = questionsData[mazo]?.[level] || [];
  } else if (mode === 'picante' && submode) {
    if (submode === 'slow_burn') {
      questions = questionsData.picante.slow_burn[level] || [];
    } else {
      questions = questionsData.picante.directo_grano || [];
    }
  } else if (mode === 'virgen') {
    questions = questionsData.virgen[level] || [];
  } else if (mode === 'apuesta') {
    questions = questionsData.apuesta.general || [];
  } else if (mode === 'coincidencia') {
    questions = questionsData.coincidencia.general || [];
  } else if (mode === 'casual') {
    questions = questionsData.casual[level] || [];
  } else {
    questions = questionsData.casual[level] || [];
  }

  if (!Array.isArray(questions)) return null;
  
  const availableQuestions = questions.filter(q => !usedQuestions.includes(q));
  if (availableQuestions.length === 0) return null;
  
  return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
}

function rollDice() {
  const opciones = questionsData.dado.opciones;
  return opciones[Math.floor(Math.random() * opciones.length)];
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
      submode: data.submode || null,
      mazo: data.mazo || null,
      inputType: data.inputType || 'text',
      timerDuration: data.timerDuration || null,
      host: socket.id,
      players: [socket.id],
      currentLevel: 1,
      currentRound: 1,
      maxRounds: data.mode === 'casual' ? 5 : 10,
      maxLevels: data.mode === 'casual' ? 4 : 3,
      questions: {},
      answers: {},
      apuestas: {},
      usedQuestions: [],
      isPlaying: false,
      roundHistory: [],
      isTyping: {},
      rematchVotes: [],
      currentDiceMode: data.mode === 'dado' ? rollDice() : null,
      skips: {
        [socket.id]: 2
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
      game.skips[socket.id] = 2;
      socket.join(data.gameId);
      users[socket.id].gameId = data.gameId;
      users[socket.id].name = data.name;
      
      console.log('   ✅ Jugador', data.name, 'se unió a la partida', data.gameId);
      
      if (game.players.length === 2) {
        game.isPlaying = true;
        
        // Asignar preguntas iniciales según el modo
        assignQuestions(game);
        
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
    const newQuestion = getRandomQuestion(
      game.currentDiceMode || game.mode, 
      game.currentLevel, 
      game.usedQuestions,
      game.submode,
      game.mazo
    );
    if (newQuestion) {
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
    
    if (game.mode === 'apuesta') {
      game.apuestas[socket.id] = {
        respuesta: data.answer,
        audio: data.audioData || null,
        isAudio: data.isAudio || false,
        prediccion: data.prediccion || null
      };
    } else if (game.mode === 'coincidencia') {
      game.answers[socket.id] = {
        text: data.answer,
        audio: data.audioData || null,
        isAudio: data.isAudio || false
      };
    } else {
      game.answers[socket.id] = {
        text: data.answer,
        audio: data.audioData || null,
        isAudio: data.isAudio || false
      };
    }
    
    // Verificar si ambos han respondido
    const player1 = game.players[0];
    const player2 = game.players[1];
    
    if (game.mode === 'apuesta') {
      if (game.apuestas[player1] && game.apuestas[player2]) {
        revealAnswers(game);
      }
    } else {
      if (game.answers[player1] && game.answers[player2]) {
        revealAnswers(game);
      }
    }
  });

  socket.on('continueNextRound', () => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    
    if (!game) return;
    
    console.log('Continuando a la siguiente ronda. Nivel:', game.currentLevel, 'Ronda:', game.currentRound);
    
    // Siguiente ronda o nivel
    game.currentRound++;
    game.answers = {};
    game.apuestas = {};
    game.isTyping = {};
    
    if (game.currentRound > game.maxRounds) {
      game.currentLevel++;
      game.currentRound = 1;
      
      // Si es modo dado, cambiar de modo en cada nivel
      if (game.mode === 'dado') {
        game.currentDiceMode = rollDice();
      }
      
      if (game.currentLevel > game.maxLevels) {
        console.log('¡Partida terminada!');
        io.to(gameId).emit('gameOver', {
          game,
          history: game.roundHistory
        });
        return;
      }
    }
    
    // Asignar nuevas preguntas
    assignQuestions(game);
    
    console.log('Nuevo estado - Nivel:', game.currentLevel, 'Ronda:', game.currentRound);
    io.to(gameId).emit('nextRound', game);
  });

  socket.on('voteRematch', () => {
    const gameId = users[socket.id].gameId;
    const game = games.find(g => g.id === gameId);
    
    if (!game) return;
    
    if (!game.rematchVotes.includes(socket.id)) {
      game.rematchVotes.push(socket.id);
    }
    
    io.to(gameId).emit('rematchVoteUpdated', {
      votes: game.rematchVotes.length,
      total: 2
    });
    
    if (game.rematchVotes.length === 2) {
      // Reiniciar la partida
      resetGame(game);
      
      io.to(gameId).emit('rematchAccepted', {
        game,
        players: [
          { id: game.players[0], name: users[game.players[0]].name },
          { id: game.players[1], name: users[game.players[1]].name }
        ]
      });
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

function assignQuestions(game) {
  const player1 = game.players[0];
  const player2 = game.players[1];
  
  if (game.mode === 'coincidencia') {
    // Ambos jugadores reciben la misma pregunta
    const q = getRandomQuestion(
      game.currentDiceMode || game.mode,
      game.currentLevel,
      game.usedQuestions,
      game.submode,
      game.mazo
    );
    if (q) {
      game.questions[player1] = q;
      game.questions[player2] = q;
      game.usedQuestions.push(q);
    }
  } else if (game.mode === 'apuesta') {
    // Cada jugador recibe una pregunta para apostar sobre el otro
    const q1 = getRandomQuestion(
      game.currentDiceMode || game.mode,
      game.currentLevel,
      game.usedQuestions,
      game.submode,
      game.mazo
    );
    const q2 = getRandomQuestion(
      game.currentDiceMode || game.mode,
      game.currentLevel,
      [...game.usedQuestions, q1],
      game.submode,
      game.mazo
    );
    
    // Invertir preguntas para apostar
    if (q1) {
      game.questions[player1] = q1; // Pregunta para apostar sobre el jugador 2
      game.usedQuestions.push(q1);
    }
    if (q2) {
      game.questions[player2] = q2; // Pregunta para apostar sobre el jugador 1
      game.usedQuestions.push(q2);
    }
  } else {
    // Modos normales: preguntas separadas
    const q1 = getRandomQuestion(
      game.currentDiceMode || game.mode,
      game.currentLevel,
      game.usedQuestions,
      game.submode,
      game.mazo
    );
    const q2 = getRandomQuestion(
      game.currentDiceMode || game.mode,
      game.currentLevel,
      [...game.usedQuestions, q1],
      game.submode,
      game.mazo
    );
    
    game.questions[player1] = q1;
    game.questions[player2] = q2;
    
    if (q1) game.usedQuestions.push(q1);
    if (q2) game.usedQuestions.push(q2);
  }
}

function revealAnswers(game) {
  const player1 = game.players[0];
  const player2 = game.players[1];
  
  let isMatch = false;
  
  if (game.mode === 'coincidencia') {
    isMatch = game.answers[player1].text === game.answers[player2].text;
  }
  
  // Guardar esta ronda en el historial
  game.roundHistory.push({
    round: game.currentRound,
    level: game.currentLevel,
    questions: {
      [player1]: game.questions[player1],
      [player2]: game.questions[player2]
    },
    answers: {
      [player1]: game.mode === 'apuesta' ? game.apuestas[player1] : game.answers[player1],
      [player2]: game.mode === 'apuesta' ? game.apuestas[player2] : game.answers[player2]
    },
    isMatch: isMatch,
    mode: game.currentDiceMode || game.mode
  });
  
  // Emitir que ambos respondieron
  io.to(game.id).emit('roundAnswers', {
    answers: {
      [player1]: { 
        name: users[player1].name, 
        answer: game.mode === 'apuesta' ? game.apuestas[player1] : game.answers[player1] 
      },
      [player2]: { 
        name: users[player2].name, 
        answer: game.mode === 'apuesta' ? game.apuestas[player2] : game.answers[player2] 
      }
    },
    questions: {
      [player1]: game.questions[player1],
      [player2]: game.questions[player2]
    },
    isMatch: isMatch
  });
}

function resetGame(game) {
  game.currentLevel = 1;
  game.currentRound = 1;
  game.questions = {};
  game.answers = {};
  game.apuestas = {};
  game.usedQuestions = [];
  game.roundHistory = [];
  game.isTyping = {};
  game.rematchVotes = [];
  game.skips = {};
  
  game.players.forEach(p => {
    game.skips[p] = 2;
  });
  
  if (game.mode === 'dado') {
    game.currentDiceMode = rollDice();
  }
  
  assignQuestions(game);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en http://0.0.0.0:${PORT}`);
  console.log(`Para acceder desde otra computadora en la misma red, usa tu IP local`);
});
