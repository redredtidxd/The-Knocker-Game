// Configura la URL de tu servidor backend aquí
const SERVER_URL = window.location.origin; // Usa la misma URL que la página frontend
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling']
});

let currentGame = null;
let currentPlayerId = null;
let players = [];

function showMainMenu() {
  hideAllScreens();
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

function hideAllScreens() {
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('createGame').classList.add('hidden');
  document.getElementById('joinGame').classList.add('hidden');
  document.getElementById('waitingRoom').classList.add('hidden');
  document.getElementById('gameScreen').classList.add('hidden');
}

function createGame() {
  const name = document.getElementById('playerName').value.trim();
  const mode = document.getElementById('gameMode').value;
  
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

function nextTurn() {
  socket.emit('nextTurn');
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
    <div class="game-item p-4 rounded-lg mb-2 flex justify-between items-center bg-gray-700" onclick="joinGame('${game.id}')">
      <div>
        <p class="text-white font-bold">Partida ${game.id}</p>
        <p class="text-gray-400 text-sm">${game.mode === 'classic' ? 'Modo Clásico' : game.mode}</p>
      </div>
      <div class="text-purple-400 font-bold">
        ${game.players.length}/2
      </div>
    </div>
  `).join('');
}

function updateGameScreen(game) {
  document.getElementById('currentLevel').textContent = game.currentLevel;
  document.getElementById('question').textContent = game.currentQuestion;
  
  const currentPlayerName = players[game.currentTurn].name;
  document.getElementById('currentPlayerTurn').textContent = currentPlayerName;
  
  const isMyTurn = players[game.currentTurn].id === socket.id;
  document.getElementById('nextTurnBtn').disabled = !isMyTurn;
  document.getElementById('nextTurnBtn').classList.toggle('opacity-50', !isMyTurn);
  document.getElementById('nextTurnBtn').classList.toggle('cursor-not-allowed', !isMyTurn);
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
  
  document.getElementById('player1Name').textContent = players[0].name;
  document.getElementById('player2Name').textContent = players[1].name;
  
  updateGameScreen(currentGame);
  showGameScreen();
});

socket.on('turnChanged', (game) => {
  currentGame = game;
  updateGameScreen(game);
});

socket.on('playerLeft', () => {
  alert('El otro jugador ha abandonado la partida');
  showMainMenu();
});

socket.on('joinError', (message) => {
  alert(message);
});

showMainMenu();
