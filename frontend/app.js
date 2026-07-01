const SERVER_URL = window.location.origin;
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling']
});

let currentGame = null;
let currentPlayerId = null;
let players = [];
let hasAnswered = false;
let currentRoomCode = null;
let typingTimeout = null;
let inputType = 'text';
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingInterval = null;
let recordedAudioBlob = null;

function hideAllScreens() {
  const screens = ['mainMenu', 'createGame', 'joinGame', 'waitingRoom', 'gameScreen', 'gameOverScreen', 'playerLeftModal'];
  screens.forEach(screen => {
    document.getElementById(screen).classList.add('hidden');
  });
}

function showMainMenu() {
  hideAllScreens();
  if (typingTimeout) clearTimeout(typingTimeout);
  document.getElementById('mainMenu').classList.remove('hidden');
}

function showCreateGame() {
  hideAllScreens();
  document.getElementById('createGame').classList.remove('hidden');
  
  // Add event listeners for game mode changes
  const gameModeInputs = document.querySelectorAll('input[name="gameMode"]');
  gameModeInputs.forEach(input => {
    input.addEventListener('change', updateInputTypeVisibility);
  });
  
  // Initial visibility check
  updateInputTypeVisibility();
}

function updateInputTypeVisibility() {
  const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
  const inputTypeSection = document.getElementById('inputTypeSection');
  
  if (selectedMode === 'casual') {
    inputTypeSection.style.display = 'block';
  } else {
    inputTypeSection.style.display = 'none';
  }
}

function showJoinGame() {
  hideAllScreens();
  document.getElementById('joinGame').classList.remove('hidden');
  
  // Add Enter key listener to joinPlayerName
  const joinPlayerNameInput = document.getElementById('joinPlayerName');
  joinPlayerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      joinGameByCode();
    }
  });
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
  const inputTypeInputs = document.querySelectorAll('input[name="inputType"]');
  let mode = 'casual';
  inputType = 'text';
  
  modeInputs.forEach(input => {
    if (input.checked) mode = input.value;
  });
  
  inputTypeInputs.forEach(input => {
    if (input.checked) inputType = input.value;
  });
  
  if (!name) {
    alert('Por favor, introduce tu nombre');
    return;
  }
  
  socket.emit('createGame', { name, mode, inputType });
}

function leaveGame() {
  if (confirm('¿Estás seguro de que quieres salir de la partida?')) {
    socket.emit('leaveGame');
    currentGame = null;
    players = [];
    showMainMenu();
  }
}

async function toggleRecording(playerNumber) {
  const recordBtn = document.getElementById(`player${playerNumber}RecordBtn`);
  const recordBtnText = document.getElementById(`player${playerNumber}RecordBtnText`);
  const indicator = document.getElementById(`player${playerNumber}RecordingIndicator`);
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording(playerNumber);
  } else {
    try {
      // First check if we can even access the microphone
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no soporta la grabación de audio. Por favor, usa un navegador moderno como Chrome o Firefox.');
        return;
      }
      
      // Check if we're in a secure context (HTTPS or localhost)
      if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert('La grabación de audio sólo funciona en sitios seguros (HTTPS). Por favor, usa HTTPS o accede desde localhost.');
        return;
      }
      
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted!');
      
      mediaRecorder = new MediaRecorder(stream);
      recordedChunks = [];
      recordingStartTime = Date.now();
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        recordedAudioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(recordedAudioBlob);
        const audioElement = document.getElementById(`player${playerNumber}Audio`);
        const audioPreview = document.getElementById(`player${playerNumber}AudioPreview`);
        
        audioElement.src = audioUrl;
        audioPreview.classList.remove('hidden');
        
        // Stop the stream tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      recordBtnText.textContent = 'Detener';
      indicator.classList.remove('hidden');
      
      // Update time counter
      recordingInterval = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        document.getElementById(`player${playerNumber}RecordingTime`).textContent = 
          `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }, 1000);
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      
      let errorMessage = 'Error al acceder al micrófono. ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Has bloqueado el acceso al micrófono. Por favor, habilítalo en la configuración de tu navegador (🔒 en la barra de direcciones).';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No se encontró un micrófono. Por favor, conecta uno e inténtalo de nuevo.';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'El micrófono está siendo usado por otra aplicación. Por favor, cierra otras apps que estén usando el micrófono.';
      } else {
        errorMessage += 'Por favor, concede los permisos necesarios cuando el navegador te lo pida.';
      }
      
      alert(errorMessage);
    }
  }
}

function stopRecording(playerNumber) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(recordingInterval);
    
    const recordBtn = document.getElementById(`player${playerNumber}RecordBtn`);
    const recordBtnText = document.getElementById(`player${playerNumber}RecordBtnText`);
    const indicator = document.getElementById(`player${playerNumber}RecordingIndicator`);
    
    recordBtnText.textContent = 'Grabar';
    indicator.classList.add('hidden');
  }
}

function clearRecording(playerNumber) {
  recordedAudioBlob = null;
  const audioElement = document.getElementById(`player${playerNumber}Audio`);
  const audioPreview = document.getElementById(`player${playerNumber}AudioPreview`);
  
  audioElement.src = '';
  audioPreview.classList.add('hidden');
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

function copyInviteLink() {
  const inviteLink = `${window.location.origin}?room=${currentRoomCode}`;
  
  // Try to use navigator.clipboard first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteLink)
      .then(showCopySuccess)
      .catch(() => copyWithFallback(inviteLink));
  } else {
    // Fallback for older browsers or non-HTTPS
    copyWithFallback(inviteLink);
  }
}

function copyWithFallback(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showCopySuccess();
  } catch (err) {
    alert('No se pudo copiar el enlace. Por favor, cópialo manualmente: ' + text);
  } finally {
    document.body.removeChild(textArea);
  }
}

function showCopySuccess() {
  const btn = document.getElementById('copyInviteBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
    </svg>
    ¡Enlace Copiado!
  `;
  btn.classList.remove('bg-green-600', 'hover:bg-green-700');
  btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
  
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
    btn.classList.add('bg-green-600', 'hover:bg-green-700');
  }, 2000);
}

function skipQuestion() {
  if (hasAnswered) return;
  socket.emit('skipQuestion');
}

async function submitAnswer() {
  if (hasAnswered) return;
  
  let answer = '';
  let audioData = null;
  
  if (inputType === 'voice') {
    if (!recordedAudioBlob) {
      alert('Por favor, graba una respuesta');
      return;
    }
    
    // Convert blob to base64
    audioData = await blobToBase64(recordedAudioBlob);
    answer = '[Audio Message';
  } else {
    if (currentPlayerId === players[0].id) {
      answer = document.getElementById('player1Answer').value.trim();
    } else if (currentPlayerId === players[1].id) {
      answer = document.getElementById('player2Answer').value.trim();
    }
    
    if (!answer) {
      alert('Por favor, escribe una respuesta');
      return;
    }
  }
  
  hasAnswered = true;
  socket.emit('submitAnswer', { answer, audioData, isAudio: inputType === 'voice' });
  
  // Disable UI
  if (currentPlayerId === players[0].id) {
    document.getElementById('player1Answer').disabled = true;
    document.getElementById('player1SubmitBtn').disabled = true;
    document.getElementById('player1SkipBtn').disabled = true;
    document.getElementById('player1RecordBtn').disabled = true;
    document.getElementById('player1SubmitBtn').textContent = 'Esperando...';
  } else if (currentPlayerId === players[1].id) {
    document.getElementById('player2Answer').disabled = true;
    document.getElementById('player2SubmitBtn').disabled = true;
    document.getElementById('player2SkipBtn').disabled = true;
    document.getElementById('player2RecordBtn').disabled = true;
    document.getElementById('player2SubmitBtn').textContent = 'Esperando...';
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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

function updateSkipsDisplay() {
  if (!currentGame) return;
  
  // Player 1
  const p1Skips = currentGame.skips[players[0].id] ?? 2;
  document.getElementById('player1Skips').textContent = `⏭️ ${p1Skips} saltos restantes`;
  document.getElementById('player1SkipBtn').disabled = p1Skips <= 0 || hasAnswered;
  
  // Player 2
  const p2Skips = currentGame.skips[players[1].id] ?? 2;
  document.getElementById('player2Skips').textContent = `⏭️ ${p2Skips} saltos restantes`;
  document.getElementById('player2SkipBtn').disabled = p2Skips <= 0 || hasAnswered;
}

function updateGameUI(game) {
  console.log('Updating UI with game:', game);
  currentGame = game;
  
  // Get input type from game if available
  if (game.inputType) {
    inputType = game.inputType;
  }
  
  document.getElementById('currentLevel').textContent = game.currentLevel;
  document.getElementById('currentRound').textContent = game.currentRound;
  
  const totalRounds = game.maxRounds * game.maxLevels;
  const completedRounds = (game.currentLevel - 1) * game.maxRounds + (game.currentRound - 1);
  const progress = (completedRounds / totalRounds) * 100;
  document.getElementById('progressBar').style.width = `${progress}%`;
  
  // Set up names and initials
  document.getElementById('player1Name').textContent = players[0].name;
  document.getElementById('player1Initial').textContent = players[0].name[0].toUpperCase();
  document.getElementById('player2Name').textContent = players[1].name;
  document.getElementById('player2Initial').textContent = players[1].name[0].toUpperCase();
  
  // Set questions - add safety check
  document.getElementById('player1Question').textContent = game.questions[players[0].id] || 'Cargando pregunta...';
  document.getElementById('player2Question').textContent = game.questions[players[1].id] || 'Cargando pregunta...';
  
  // Show/hide text/voice inputs based on input type
  const player1TextInput = document.getElementById('player1TextInput');
  const player1VoiceInput = document.getElementById('player1VoiceInput');
  const player2TextInput = document.getElementById('player2TextInput');
  const player2VoiceInput = document.getElementById('player2VoiceInput');
  
  if (inputType === 'voice') {
    player1TextInput.classList.add('hidden');
    player2TextInput.classList.add('hidden');
    player1VoiceInput.classList.remove('hidden');
    player2VoiceInput.classList.remove('hidden');
  } else {
    player1TextInput.classList.remove('hidden');
    player2TextInput.classList.remove('hidden');
    player1VoiceInput.classList.add('hidden');
    player2VoiceInput.classList.add('hidden');
  }
  
  // Reset UI for new round
  hasAnswered = false;
  recordedAudioBlob = null;
  
  // Reset text inputs
  document.getElementById('player1Answer').value = '';
  document.getElementById('player1Answer').disabled = false;
  document.getElementById('player1SubmitBtn').disabled = false;
  document.getElementById('player1SubmitBtn').textContent = 'Enviar Respuesta';
  document.getElementById('player1SkipBtn').disabled = false;
  
  document.getElementById('player2Answer').value = '';
  document.getElementById('player2Answer').disabled = false;
  document.getElementById('player2SubmitBtn').disabled = false;
  document.getElementById('player2SubmitBtn').textContent = 'Enviar Respuesta';
  document.getElementById('player2SkipBtn').disabled = false;
  
  // Reset audio previews
  document.getElementById('player1AudioPreview').classList.add('hidden');
  document.getElementById('player2AudioPreview').classList.add('hidden');
  document.getElementById('player1Audio').src = '';
  document.getElementById('player2Audio').src = '';
  
  // Only enable your own input
  if (currentPlayerId === players[0].id) {
    // Disable player 2's inputs
    document.getElementById('player2Answer').disabled = true;
    document.getElementById('player2SubmitBtn').disabled = true;
    document.getElementById('player2SkipBtn').disabled = true;
    document.getElementById('player2RecordBtn').disabled = true;
    document.getElementById('player2SubmitBtn').textContent = 'Es turno del otro jugador';
  } else {
    // Disable player 1's inputs
    document.getElementById('player1Answer').disabled = true;
    document.getElementById('player1SubmitBtn').disabled = true;
    document.getElementById('player1SkipBtn').disabled = true;
    document.getElementById('player1RecordBtn').disabled = true;
    document.getElementById('player1SubmitBtn').textContent = 'Es turno del otro jugador';
  }
  
  // Render history
  renderHistory(game.roundHistory);
  
  // Update skips display
  updateSkipsDisplay();
  
  // Show questions, hide answers
  document.getElementById('gameContent').classList.remove('hidden');
  document.getElementById('answersReveal').classList.add('hidden');
}

function renderHistory(history) {
  const historySection = document.getElementById('historySection');
  if (!history || history.length === 0) {
    historySection.innerHTML = '';
    return;
  }
  
  historySection.innerHTML = `
    <h3 class="text-gray-400 text-lg font-bold mb-4">Historial</h3>
    ${history.map((round, index) => `
      <div class="bg-gray-800/50 rounded-2xl p-4">
        <div class="text-gray-500 text-sm mb-3">Ronda ${round.round} - Nivel ${round.level}</div>
        <div class="space-y-4">
          <div class="flex items-start gap-4">
            <div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              ${players[0].name[0].toUpperCase()}
            </div>
            <div class="flex-1">
              <p class="text-gray-400 text-xs mb-1">${round.questions[players[0].id]}</p>
              ${(round.answers[players[0].id] && round.answers[players[0].id].isAudio) ? `<audio controls class="w-full" src="${round.answers[players[0].id].audio}"></audio>` : `<p class="text-purple-300">${round.answers[players[0].id].text || round.answers[players[0].id]}</p>`}
            </div>
          </div>
          <div class="flex items-start gap-4 flex-row-reverse">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              ${players[1].name[0].toUpperCase()}
            </div>
            <div class="flex-1 text-right">
              <p class="text-gray-400 text-xs mb-1">${round.questions[players[1].id]}</p>
              ${(round.answers[players[1].id] && round.answers[players[1].id].isAudio) ? `<audio controls class="w-full" src="${round.answers[players[1].id].audio}"></audio>` : `<p class="text-blue-300">${round.answers[players[1].id].text || round.answers[players[1].id]}</p>`}
            </div>
          </div>
        </div>
      </div>
    `).join('')}
  `;
}

function continueNextRound() {
  socket.emit('continueNextRound');
}

function showAnswers(data) {
  console.log('Showing answers:', data);
  
  // Update currentGame with latest history
  if (currentGame) {
    // The history is already in currentGame from the server
    // We just need to make sure we use it
  }
  
  document.getElementById('gameContent').classList.add('hidden');
  document.getElementById('answersReveal').classList.remove('hidden');
  
  // Player 1
  document.getElementById('revealPlayer1Initial').textContent = players[0].name[0].toUpperCase();
  document.getElementById('revealPlayer1Question').textContent = data.questions[players[0].id];
  document.getElementById('revealPlayer1Name').textContent = data.answers[players[0].id].name;
  const player1AnswerData = data.answers[players[0].id].answer;
  const revealPlayer1Text = document.getElementById('revealPlayer1Answer');
  const revealPlayer1Audio = document.getElementById('revealPlayer1Audio');
  
  if (player1AnswerData && player1AnswerData.isAudio) {
    revealPlayer1Text.textContent = '';
    revealPlayer1Text.classList.add('hidden');
    revealPlayer1Audio.classList.remove('hidden');
    revealPlayer1Audio.src = player1AnswerData.audio;
  } else {
    revealPlayer1Audio.classList.add('hidden');
    revealPlayer1Text.classList.remove('hidden');
    revealPlayer1Text.textContent = player1AnswerData.text || player1AnswerData;
  }
  
  // Player 2
  document.getElementById('revealPlayer2Initial').textContent = players[1].name[0].toUpperCase();
  document.getElementById('revealPlayer2Question').textContent = data.questions[players[1].id];
  document.getElementById('revealPlayer2Name').textContent = data.answers[players[1].id].name;
  const player2AnswerData = data.answers[players[1].id].answer;
  const revealPlayer2Text = document.getElementById('revealPlayer2Answer');
  const revealPlayer2Audio = document.getElementById('revealPlayer2Audio');
  
  if (player2AnswerData && player2AnswerData.isAudio) {
    revealPlayer2Text.textContent = '';
    revealPlayer2Text.classList.add('hidden');
    revealPlayer2Audio.classList.remove('hidden');
    revealPlayer2Audio.src = player2AnswerData.audio;
  } else {
    revealPlayer2Audio.classList.add('hidden');
    revealPlayer2Text.classList.remove('hidden');
    revealPlayer2Text.textContent = player2AnswerData.text || player2AnswerData;
  }
}

function setupTypingListeners() {
  ['player1Answer', 'player2Answer'].forEach(id => {
    const textarea = document.getElementById(id);
    if (!textarea) return;
    
    textarea.addEventListener('input', () => {
      // Only send typing if this is our textarea
      if (currentPlayerId === players[0].id && id === 'player1Answer') {
        handleTyping();
      } else if (currentPlayerId === players[1].id && id === 'player2Answer') {
        handleTyping();
      }
    });
  });
}

function handleTyping() {
  socket.emit('typing', true);
  
  if (typingTimeout) clearTimeout(typingTimeout);
  
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 1000);
}

socket.on('connect', () => {
  currentPlayerId = socket.id;
  console.log('Connected with ID:', currentPlayerId);
  
  // Check URL for room code
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  if (roomCode) {
    document.getElementById('joinGame').classList.remove('hidden');
    document.getElementById('gameCode').value = roomCode;
    document.getElementById('mainMenu').classList.add('hidden');
    
    // Pre-fill the room code and automatically focus the name input
    document.getElementById('joinPlayerName').focus();
  }
});

socket.on('gameList', (games) => {
  updateGameList(games);
});

socket.on('gameCreated', (game) => {
  currentGame = game;
  currentRoomCode = game.id;
  document.getElementById('roomCode').textContent = game.id;
  const inviteLink = `${window.location.origin}?room=${game.id}`;
  document.getElementById('inviteLinkDisplay').textContent = inviteLink;
  showWaitingRoom();
});

socket.on('joinedGame', (game) => {
  currentGame = game;
});

socket.on('gameStarted', (data) => {
  console.log('Game started:', data);
  currentGame = data.game;
  players = data.players;
  setupTypingListeners();
  updateGameUI(currentGame);
  showGameScreen();
});

socket.on('playerTyping', (data) => {
  const typingEl = data.playerId === players[0].id 
    ? document.getElementById('player1Typing') 
    : document.getElementById('player2Typing');
  
  if (typingEl) {
    if (data.isTyping) {
      typingEl.classList.remove('hidden');
    } else {
      typingEl.classList.add('hidden');
    }
  }
});

socket.on('questionSkipped', (data) => {
  console.log('Question skipped:', data);
  currentGame = data.game;
  
  if (data.playerId === currentPlayerId) {
    alert(`Pregunta saltada! Te quedan ${data.skipsLeft} saltos.`);
  }
  
  updateGameUI(currentGame);
});

socket.on('noSkipsLeft', () => {
  alert('¡No te quedan saltos!');
});

socket.on('roundAnswers', (data) => {
  console.log('Received round answers:', data);
  // Ensure currentGame has the latest round history
  if (currentGame && data.answers && data.questions) {
    // Check if we need to add to history
    const player1 = players[0].id;
    const player2 = players[1].id;
    if (player1 && player2 && currentGame.roundHistory) {
      const lastRound = currentGame.roundHistory[currentGame.roundHistory.length - 1];
      // Only add if not already there
      if (!lastRound || lastRound.round !== currentGame.currentRound || lastRound.level !== currentGame.currentLevel) {
        currentGame.roundHistory.push({
          round: currentGame.currentRound,
          level: currentGame.currentLevel,
          questions: {
            [player1]: data.questions[player1],
            [player2]: data.questions[player2]
          },
          answers: {
            [player1]: data.answers[player1].answer,
            [player2]: data.answers[player2].answer
          }
        });
      }
    }
  }
  showAnswers(data);
});

socket.on('nextRound', (game) => {
  console.log('Received next round:', game);
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
