const SERVER_URL = window.location.origin;
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling']
});

let currentGame = null;
let currentPlayerId = null;
let players = [];
let hasAnswered = false;
let countdownInterval = null;

function hideAllScreens() {
  const screens = ['mainMenu', 'createGame', 'joinGame', 'waitingRoom', 'gameScreen', 'gameOverScreen', 'playerLeftModal'];
  screens.forEach(screen => {
    document.getElementById(screen).classList.add('hidden');
  });
}

function showMainMenu() {
  hideAllScreens();
  if (countdownInterval) clearInterval(countdownInterval);
  document.getElementById('mainMenu').classList.remove('hidden');
}

function showCreateGame() {
  hideAllScreens();
  document.getElementById('createGame').classList.remove('hidden');
}

function showJoinGame() {
  hideAllScreens();
  document.getElementById('joinGame').classList.remove('hidden');
}

function showWaitingRoom() {
  hideAllScreens();
  document.getElementById('waitingRoom').classList.remove('hidden');
}

function showGameScreen() {
  hideAllScreens();
  document.getElementById('gameScreen').classList.remove('hidden');
}

function showGameOverScreen() {
  hideAllScreens();
  document.getElementById('gameOverScreen').classList.remove('hidden');
}

function showPlayerLeftModal(playerName) {
  document.getElementById('playerLeftText').textContent = `${playerName} ha abandonado la partida.`;
  document.getElementById('playerLeftModal').classList.remove('hidden');
}

function createGame() {
  const name = document.getElementById('playerName').value.trim();
  const modeInputs = document.querySelectorAll('input[name="gameMode"]');
  let mode = 'casual';
  
  modeInputs.forEach(input => {
    if (input.checked) mode = input.value;
  });
  
  if (!name) {
    alert('Por favor, introduce tu nombre');
    return;
  }
  
  socket.emit('createGame', { name, mode });
}

function joinGameByCode() {
  const name = document.getElementById('joinPlayerName').value.trim();
  const code = document.getElementById('gameCode').value.trim().toUpperCase();
  
  if (!name) {
    alert('Por favor, introduce tu nombre');
    return;
  }
  
  if (!code || code.length !== 4) {
    alert('Por favor, introduce un código válido de 4 caracteres');
    return;
  }
  
  socket.emit('joinGame', { name, gameId: code });
}

function joinGame(gameId) {
  const name = document.getElementById('joinPlayerName').value.trim();
  
  if (!name) {
    alert('Por favor, introduce tu nombre');
    return;
  }
  
  socket.emit('joinGame', { name, gameId });
}

function submitAnswer() {
  if (hasAnswered) return;
  
  let answer = '';
  if (currentPlayerId === players[0].id) {
    answer = document.getElementById('player1Answer').value.trim();
  } else if (currentPlayerId === players[1].id) {
    answer = document.getElementById('player2Answer').value.trim();
  }
  
  if (!answer) {
    alert('Por favor, escribe una respuesta');
    return;
  }
  
  hasAnswered = true;
  socket.emit('submitAnswer', { answer });
  
  // Disable UI
  if (currentPlayerId === players[0].id) {
    document.getElementById('player1Answer').disabled = true;
    document.getElementById('player1SubmitBtn').disabled = true;
    document.getElementById('player1SubmitBtn').textContent = 'Esperando...';
  } else if (currentPlayerId === players[1].id) {
    document.getElementById('player2Answer').disabled = true;
    document.getElementById('player2SubmitBtn').disabled = true;
    document.getElementById('player2SubmitBtn').textContent = 'Esperando...';
  }
}

function leaveGame() {
  socket.emit('leaveGame');
  showMainMenu();
}

function updateGameList(games) {
  const listDiv = document.getElementById('gameList');
  
  if (games.length === 0) {
    listDiv.innerHTML = '<p class="text-gray-500 text-center">No hay partidas disponibles</p>';
    return;
  }
  
  listDiv.innerHTML = games.map(game => `
    <div class="game-item p-4 rounded-xl mb-2 flex justify-between items-center bg-gray-700 cursor-pointer hover:bg-gray-600 transition" onclick="joinGame('${game.id}')">
      <div>
        <p class="text-white font-bold">Partida ${game.id}</p>
        <p class="text-gray-400 text-sm">${game.mode === 'casual' ? 'Modo Casual' : game.mode}</p>
      </div>
      <div class="text-purple-400 font-bold">
        ${game.players.length}/2
      </div>
    </div>
  `).join('');
}

function updateGameUI(game) {
  document.getElementById('currentLevel').textContent = game.currentLevel;
  document.getElementById('currentRound').textContent = game.currentRound;
  
  const totalRounds = game.maxRounds * game.maxLevels;
  const completedRounds = (game.currentLevel - 1) * game.maxRounds + game.currentRound - 1;
  const progress = (completedRounds / totalRounds) * 100;
  document.getElementById('progressBar').style.width = `${progress}%`;
  
  // Set up names and initials
  document.getElementById('player1Name').textContent = players[0].name;
  document.getElementById('player1Initial').textContent = players[0].name[0].toUpperCase();
  document.getElementById('player2Name').textContent = players[1].name;
  document.getElementById('player2Initial').textContent = players[1].name[0].toUpperCase();
  
  // Set questions
  document.getElementById('player1Question').textContent = game.questions[players[0].id];
  document.getElementById('player2Question').textContent = game.questions[players[1].id];
  
  // Reset UI
  hasAnswered = false;
  document.getElementById('player1Answer').value = '';
  document.getElementById('player1Answer').disabled = false;
  document.getElementById('player1SubmitBtn').disabled = false;
  document.getElementById('player1SubmitBtn').textContent = 'Enviar Respuesta';
  
  document.getElementById('player2Answer').value = '';
  document.getElementById('player2Answer').disabled = false;
  document.getElementById('player2SubmitBtn').disabled = false;
  document.getElementById('player2SubmitBtn').textContent = 'Enviar Respuesta';
  
  // Only show your own textarea enabled
  if (currentPlayerId === players[0].id) {
    document.getElementById('player2Answer').disabled = true;
    document.getElementById('player2SubmitBtn').disabled = true;
    document.getElementById('player2SubmitBtn').textContent = 'Es turno del otro jugador';
  } else {
    document.getElementById('player1Answer').disabled = true;
    document.getElementById('player1SubmitBtn').disabled = true;
    document.getElementById('player1SubmitBtn').textContent = 'Es turno del otro jugador';
  }
  
  // Show questions, hide answers
  document.getElementById('gameContent').classList.remove('hidden');
  document.getElementById('answersReveal').classList.add('hidden');
}

function showAnswers(data) {
  document.getElementById('gameContent').classList.add('hidden');
  document.getElementById('answersReveal').classList.remove('hidden');
  
  // Player 1
  document.getElementById('revealPlayer1Initial').textContent = players[0].name[0].toUpperCase();
  document.getElementById('revealPlayer1Question').textContent = data.questions[players[0].id];
  document.getElementById('revealPlayer1Name').textContent = data.answers[players[0].id].name;
  document.getElementById('revealPlayer1Answer').textContent = data.answers[players[0].id].answer;
  
  // Player 2
  document.getElementById('revealPlayer2Initial').textContent = players[1].name[0].toUpperCase();
  document.getElementById('revealPlayer2Question').textContent = data.questions[players[1].id];
  document.getElementById('revealPlayer2Name').textContent = data.answers[players[1].id].name;
  document.getElementById('revealPlayer2Answer').textContent = data.answers[players[1].id].answer;
  
  // Countdown
  let countdown = 5;
  document.getElementById('countdown').textContent = countdown;
  
  countdownInterval = setInterval(() => {
    countdown--;
    document.getElementById('countdown').textContent = countdown;
    if (countdown <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
}

socket.on('connect', () => {
  currentPlayerId = socket.id;
});

socket.on('gameList', (games) => {
  updateGameList(games);
});

socket.on('gameCreated', (game) => {
  currentGame = game;
  document.getElementById('roomCode').textContent = game.id;
  showWaitingRoom();
});

socket.on('joinedGame', (game) => {
  currentGame = game;
});

socket.on('gameStarted', (data) => {
  currentGame = data.game;
  players = data.players;
  updateGameUI(currentGame);
  showGameScreen();
});

socket.on('roundAnswers', (data) => {
  showAnswers(data);
});

socket.on('nextRound', (game) => {
  currentGame = game;
  updateGameUI(currentGame);
});

socket.on('gameOver', () => {
  showGameOverScreen();
});

socket.on('playerLeft', (data) => {
  showPlayerLeftModal(data.playerName);
});

socket.on('joinError', (message) => {
  alert(message);
});

showMainMenu();
