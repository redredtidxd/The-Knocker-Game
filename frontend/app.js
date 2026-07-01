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
    const el = document.getElementById(screen);
    if (el) el.classList.add('hidden');
  });
}

function showMainMenu() {
  hideAllScreens();
  if (typingTimeout) clearTimeout(typingTimeout);
  const mainMenu = document.getElementById('mainMenu');
  if (mainMenu) mainMenu.classList.remove('hidden');
}

function updateInputTypeVisibility() {
  const casualRadio = document.getElementById('gameModeCasual');
  const inputTypeSection = document.getElementById('inputTypeSection');
  
  if (casualRadio && inputTypeSection) {
    if (casualRadio.checked) {
      inputTypeSection.classList.remove('hidden');
    } else {
      inputTypeSection.classList.add('hidden');
    }
  }
}

function showCreateGame() {
  hideAllScreens();
  const createGameScreen = document.getElementById('createGame');
  if (createGameScreen) createGameScreen.classList.remove('hidden');
  
  // Set up listeners for game mode changes
  const modeInputs = document.querySelectorAll('input[name="gameMode"]');
  modeInputs.forEach(input => {
    input.addEventListener('change', updateInputTypeVisibility);
  });
  
  // Initial check
  updateInputTypeVisibility();
}

function showJoinGame() {
  hideAllScreens();
  const joinGameScreen = document.getElementById('joinGame');
  if (joinGameScreen) joinGameScreen.classList.remove('hidden');
}

function showWaitingRoom() {
  hideAllScreens();
  const waitingRoomScreen = document.getElementById('waitingRoom');
  if (waitingRoomScreen) waitingRoomScreen.classList.remove('hidden');
}

function showGameScreen() {
  hideAllScreens();
  const gameScreen = document.getElementById('gameScreen');
  if (gameScreen) gameScreen.classList.remove('hidden');
}

function showGameOverScreen() {
  hideAllScreens();
  const gameOverScreen = document.getElementById('gameOverScreen');
  if (gameOverScreen) gameOverScreen.classList.remove('hidden');
}

function showPlayerLeftModal(playerName) {
  const modal = document.getElementById('playerLeftModal');
  const text = document.getElementById('playerLeftText');
  if (text) text.textContent = `${playerName} ha abandonado la partida.`;
  if (modal) modal.classList.remove('hidden');
}

function createGame() {
  const nameInput = document.getElementById('playerName');
  const name = nameInput ? nameInput.value.trim() : '';
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
    return;
  }

  try {
    console.log('=== Starting Recording Process ===');
    console.log('Full URL:', window.location.href);
    console.log('navigator.mediaDevices:', !!navigator.mediaDevices);
    console.log('navigator.mediaDevices.getUserMedia:', !!navigator.mediaDevices?.getUserMedia);
    console.log('window.isSecureContext:', window.isSecureContext);
    console.log('hostname:', window.location.hostname);

    // Basic compatibility check
    if (!navigator.mediaDevices) {
      console.error('navigator.mediaDevices not found!');
      alert('Tu navegador no tiene soporte para acceder al micrófono. Por favor, usa Chrome o Firefox.');
      return;
    }

    if (!navigator.mediaDevices.getUserMedia) {
      console.error('getUserMedia not found!');
      alert('Tu navegador no soporta la función de grabación de audio. Por favor, actualiza tu navegador.');
      return;
    }

    if (typeof window.MediaRecorder === 'undefined') {
      console.error('MediaRecorder not found!');
      alert('Tu navegador no soporta MediaRecorder. Por favor, usa Chrome o Firefox.');
      return;
    }

    console.log('Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('✅ Microphone access granted!');

    recordedChunks = [];
    recordingStartTime = Date.now();
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      console.log('Data available:', event.data.size);
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      console.log('Recording stopped, chunks:', recordedChunks.length);
      
      if (recordedChunks.length > 0) {
        recordedAudioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(recordedAudioBlob);
        console.log('Audio blob created, size:', recordedAudioBlob.size, 'URL:', audioUrl);
        
        const audioElement = document.getElementById(`player${playerNumber}Audio`);
        const audioPreview = document.getElementById(`player${playerNumber}AudioPreview`);
        
        if (audioElement) audioElement.src = audioUrl;
        if (audioPreview) audioPreview.classList.remove('hidden');
      } else {
        alert('No se grabó audio. Por favor, inténtalo de nuevo.');
      }

      // Stop the stream tracks
      stream.getTracks().forEach(track => {
        console.log('Stopping track:', track.kind);
        track.stop();
      });
    };

    mediaRecorder.start(1000); // Collect data every 1 second
    console.log('MediaRecorder started');
    
    if (recordBtnText) recordBtnText.textContent = 'Detener';
    if (indicator) indicator.classList.remove('hidden');

    // Update time counter
    recordingInterval = setInterval(() => {
      const elapsed = Date.now() - recordingStartTime;
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const timeEl = document.getElementById(`player${playerNumber}RecordingTime`);
      if (timeEl) {
        timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);

  } catch (error) {
    console.error('❌ Error accessing microphone:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    let errorMessage = 'Error al acceder al micrófono. ';
    
    if (error.name === 'NotAllowedError') {
      errorMessage += 'Has bloqueado el acceso al micrófono. Por favor, habilítalo en la configuración de tu navegador (🔒 en la barra de direcciones) y actualiza la página.';
    } else if (error.name === 'NotFoundError') {
      errorMessage += 'No se encontró un micrófono. Por favor, conecta uno e inténtalo de nuevo.';
    } else if (error.name === 'NotReadableError') {
      errorMessage += 'El micrófono está siendo usado por otra aplicación. Por favor, cierra otras apps que estén usando el micrófono y actualiza la página.';
    } else {
      errorMessage += `Error: ${error.message}`;
    }
    
    alert(errorMessage);
  }
}

function stopRecording(playerNumber) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('Stopping recording...');
    mediaRecorder.stop();
    if (recordingInterval) clearInterval(recordingInterval);
    
    const recordBtnText = document.getElementById(`player${playerNumber}RecordBtnText`);
    const indicator = document.getElementById(`player${playerNumber}RecordingIndicator`);
    
    if (recordBtnText) recordBtnText.textContent = 'Grabar';
    if (indicator) indicator.classList.add('hidden');
  }
}

function clearRecording(playerNumber) {
  recordedAudioBlob = null;
  const audioElement = document.getElementById(`player${playerNumber}Audio`);
  const audioPreview = document.getElementById(`player${playerNumber}AudioPreview`);
  
  if (audioElement) audioElement.src = '';
  if (audioPreview) audioPreview.classList.add('hidden');
}

function joinGameByCode() {
  const nameInput = document.getElementById('joinPlayerName');
  const codeInput = document.getElementById('gameCode');
  const name = nameInput ? nameInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  
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
  const nameInput = document.getElementById('joinPlayerName');
  const name = nameInput ? nameInput.value.trim() : '';
  
  if (!name) {
    alert('Por favor, introduce tu nombre');
    return;
  }
  
  socket.emit('joinGame', { name, gameId });
}

function copyInviteLink() {
  const inviteLink = `${window.location.origin}?room=${currentRoomCode}`;
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteLink).then(showCopySuccess).catch(() => copyWithFallback(inviteLink));
  } else {
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
    const successful = document.execCommand('copy');
    if (successful) showCopySuccess();
  } catch (err) {
    alert('No se pudo copiar el enlace. Por favor, cópialo manualmente: ' + text);
  } finally {
    document.body.removeChild(textArea);
  }
}

function showCopySuccess() {
  const btn = document.getElementById('copyInviteBtn');
  if (!btn) return;
  
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
    </svg>
    ¡Enlace Copiado!
  `;
  btn.classList.remove('bg-green-600', 'hover:bg-green-700');
  btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
  
  setTimeout(() => {
    btn.innerHTML = originalHTML;
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
      alert('Por favor, graba una respuesta primero');
      return;
    }
    
    // Convert blob to base64
    audioData = await blobToBase64(recordedAudioBlob);
    answer = '[Mensaje de voz]';
  } else {
    if (currentPlayerId === players[0].id) {
      const el = document.getElementById('player1Answer');
      answer = el ? el.value.trim() : '';
    } else if (currentPlayerId === players[1].id) {
      const el = document.getElementById('player2Answer');
      answer = el ? el.value.trim() : '';
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
    const answerEl = document.getElementById('player1Answer');
    const submitBtn = document.getElementById('player1SubmitBtn');
    const skipBtn = document.getElementById('player1SkipBtn');
    const recordBtn = document.getElementById('player1RecordBtn');
    
    if (answerEl) answerEl.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    if (recordBtn) recordBtn.disabled = true;
    if (submitBtn) submitBtn.textContent = 'Esperando...';
  } else if (currentPlayerId === players[1].id) {
    const answerEl = document.getElementById('player2Answer');
    const submitBtn = document.getElementById('player2SubmitBtn');
    const skipBtn = document.getElementById('player2SkipBtn');
    const recordBtn = document.getElementById('player2RecordBtn');
    
    if (answerEl) answerEl.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    if (recordBtn) recordBtn.disabled = true;
    if (submitBtn) submitBtn.textContent = 'Esperando...';
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
  if (!listDiv) return;
  
  if (!games || games.length === 0) {
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
  const p1Skips = currentGame.skips?.[players[0].id] ?? 2;
  const p1SkipsEl = document.getElementById('player1Skips');
  const p1SkipBtn = document.getElementById('player1SkipBtn');
  
  if (p1SkipsEl) p1SkipsEl.textContent = `⏭️ ${p1Skips} saltos restantes`;
  if (p1SkipBtn) p1SkipBtn.disabled = p1Skips <= 0 || hasAnswered;
  
  // Player 2
  const p2Skips = currentGame.skips?.[players[1].id] ?? 2;
  const p2SkipsEl = document.getElementById('player2Skips');
  const p2SkipBtn = document.getElementById('player2SkipBtn');
  
  if (p2SkipsEl) p2SkipsEl.textContent = `⏭️ ${p2Skips} saltos restantes`;
  if (p2SkipBtn) p2SkipBtn.disabled = p2Skips <= 0 || hasAnswered;
}

function updateGameUI(game) {
  console.log('Updating UI with game:', game);
  currentGame = game;
  
  // Get input type from game if available
  if (game.inputType) {
    inputType = game.inputType;
  }
  
  const currentLevelEl = document.getElementById('currentLevel');
  const currentRoundEl = document.getElementById('currentRound');
  const progressBar = document.getElementById('progressBar');
  
  if (currentLevelEl) currentLevelEl.textContent = game.currentLevel;
  if (currentRoundEl) currentRoundEl.textContent = game.currentRound;
  
  if (progressBar && game.maxRounds && game.maxLevels) {
    const totalRounds = game.maxRounds * game.maxLevels;
    const completedRounds = (game.currentLevel - 1) * game.maxRounds + (game.currentRound - 1);
    const progress = (completedRounds / totalRounds) * 100;
    progressBar.style.width = `${progress}%`;
  }
  
  // Set up names and initials
  const player1NameEl = document.getElementById('player1Name');
  const player1InitialEl = document.getElementById('player1Initial');
  const player2NameEl = document.getElementById('player2Name');
  const player2InitialEl = document.getElementById('player2Initial');
  
  if (player1NameEl && players[0]) player1NameEl.textContent = players[0].name;
  if (player1InitialEl && players[0]) player1InitialEl.textContent = players[0].name[0].toUpperCase();
  if (player2NameEl && players[1]) player2NameEl.textContent = players[1].name;
  if (player2InitialEl && players[1]) player2InitialEl.textContent = players[1].name[0].toUpperCase();
  
  // Set questions
  const player1QuestionEl = document.getElementById('player1Question');
  const player2QuestionEl = document.getElementById('player2Question');
  
  if (player1QuestionEl && players[0]) {
    player1QuestionEl.textContent = game.questions?.[players[0].id] || 'Cargando pregunta...';
  }
  if (player2QuestionEl && players[1]) {
    player2QuestionEl.textContent = game.questions?.[players[1].id] || 'Cargando pregunta...';
  }
  
  // Show/hide text/voice inputs based on input type
  const player1TextInput = document.getElementById('player1TextInput');
  const player1VoiceInput = document.getElementById('player1VoiceInput');
  const player2TextInput = document.getElementById('player2TextInput');
  const player2VoiceInput = document.getElementById('player2VoiceInput');
  
  if (inputType === 'voice') {
    if (player1TextInput) player1TextInput.classList.add('hidden');
    if (player2TextInput) player2TextInput.classList.add('hidden');
    if (player1VoiceInput) player1VoiceInput.classList.remove('hidden');
    if (player2VoiceInput) player2VoiceInput.classList.remove('hidden');
  } else {
    if (player1TextInput) player1TextInput.classList.remove('hidden');
    if (player2TextInput) player2TextInput.classList.remove('hidden');
    if (player1VoiceInput) player1VoiceInput.classList.add('hidden');
    if (player2VoiceInput) player2VoiceInput.classList.add('hidden');
  }
  
  // Reset UI for new round
  hasAnswered = false;
  recordedAudioBlob = null;
  
  // Reset text inputs
  const player1AnswerEl = document.getElementById('player1Answer');
  const player1SubmitBtn = document.getElementById('player1SubmitBtn');
  const player1SkipBtn = document.getElementById('player1SkipBtn');
  const player1RecordBtn = document.getElementById('player1RecordBtn');
  const player1AudioPreview = document.getElementById('player1AudioPreview');
  const player1Audio = document.getElementById('player1Audio');
  
  if (player1AnswerEl) player1AnswerEl.value = '';
  if (player1AnswerEl) player1AnswerEl.disabled = false;
  if (player1SubmitBtn) player1SubmitBtn.disabled = false;
  if (player1SubmitBtn) player1SubmitBtn.textContent = 'Enviar Respuesta';
  if (player1SkipBtn) player1SkipBtn.disabled = false;
  if (player1RecordBtn) player1RecordBtn.disabled = false;
  if (player1AudioPreview) player1AudioPreview.classList.add('hidden');
  if (player1Audio) player1Audio.src = '';
  
  const player2AnswerEl = document.getElementById('player2Answer');
  const player2SubmitBtn = document.getElementById('player2SubmitBtn');
  const player2SkipBtn = document.getElementById('player2SkipBtn');
  const player2RecordBtn = document.getElementById('player2RecordBtn');
  const player2AudioPreview = document.getElementById('player2AudioPreview');
  const player2Audio = document.getElementById('player2Audio');
  
  if (player2AnswerEl) player2AnswerEl.value = '';
  if (player2AnswerEl) player2AnswerEl.disabled = false;
  if (player2SubmitBtn) player2SubmitBtn.disabled = false;
  if (player2SubmitBtn) player2SubmitBtn.textContent = 'Enviar Respuesta';
  if (player2SkipBtn) player2SkipBtn.disabled = false;
  if (player2RecordBtn) player2RecordBtn.disabled = false;
  if (player2AudioPreview) player2AudioPreview.classList.add('hidden');
  if (player2Audio) player2Audio.src = '';
  
  // Only enable your own input
  if (currentPlayerId === players[0].id) {
    if (player2AnswerEl) player2AnswerEl.disabled = true;
    if (player2SubmitBtn) player2SubmitBtn.disabled = true;
    if (player2SkipBtn) player2SkipBtn.disabled = true;
    if (player2RecordBtn) player2RecordBtn.disabled = true;
    if (player2SubmitBtn) player2SubmitBtn.textContent = 'Es turno del otro jugador';
  } else {
    if (player1AnswerEl) player1AnswerEl.disabled = true;
    if (player1SubmitBtn) player1SubmitBtn.disabled = true;
    if (player1SkipBtn) player1SkipBtn.disabled = true;
    if (player1RecordBtn) player1RecordBtn.disabled = true;
    if (player1SubmitBtn) player1SubmitBtn.textContent = 'Es turno del otro jugador';
  }
  
  // Render history
  renderHistory(game.roundHistory);
  
  // Update skips display
  updateSkipsDisplay();
  
  // Show questions, hide answers
  const gameContent = document.getElementById('gameContent');
  const answersReveal = document.getElementById('answersReveal');
  
  if (gameContent) gameContent.classList.remove('hidden');
  if (answersReveal) answersReveal.classList.add('hidden');
}

function renderHistory(history) {
  const historySection = document.getElementById('historySection');
  if (!historySection) return;
  
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
              ${players[0]?.name[0]?.toUpperCase() || 'P1'}
            </div>
            <div class="flex-1">
              <p class="text-gray-400 text-xs mb-1">${round.questions?.[players[0].id] || ''}</p>
              ${(round.answers?.[players[0].id] && round.answers?.[players[0].id].isAudio) ? `<audio controls class="w-full" src="${round.answers[players[0].id].audio}"></audio>` : `<p class="text-purple-300">${round.answers?.[players[0].id]?.text || round.answers?.[players[0].id] || ''}</p>`}
            </div>
          </div>
          <div class="flex items-start gap-4 flex-row-reverse">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              ${players[1]?.name[0]?.toUpperCase() || 'P2'}
            </div>
            <div class="flex-1 text-right">
              <p class="text-gray-400 text-xs mb-1">${round.questions?.[players[1].id] || ''}</p>
              ${(round.answers?.[players[1].id] && round.answers?.[players[1].id].isAudio) ? `<audio controls class="w-full" src="${round.answers[players[1].id].audio}"></audio>` : `<p class="text-blue-300">${round.answers?.[players[1].id]?.text || round.answers?.[players[1].id] || ''}</p>`}
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
  
  const gameContent = document.getElementById('gameContent');
  const answersReveal = document.getElementById('answersReveal');
  
  if (gameContent) gameContent.classList.add('hidden');
  if (answersReveal) answersReveal.classList.remove('hidden');
  
  // Player 1
  const revealPlayer1Initial = document.getElementById('revealPlayer1Initial');
  const revealPlayer1Question = document.getElementById('revealPlayer1Question');
  const revealPlayer1Name = document.getElementById('revealPlayer1Name');
  
  if (revealPlayer1Initial && players[0]?.name) {
    revealPlayer1Initial.textContent = players[0].name[0].toUpperCase();
  }
  if (revealPlayer1Question && players[0]?.id) {
    revealPlayer1Question.textContent = data.questions?.[players[0].id];
  }
  if (revealPlayer1Name && players[0]?.id) {
    revealPlayer1Name.textContent = data.answers?.[players[0].id]?.name;
  }
  
  const player1AnswerData = data.answers?.[players[0]?.id]?.answer;
  const revealPlayer1Text = document.getElementById('revealPlayer1Answer');
  const revealPlayer1Audio = document.getElementById('revealPlayer1Audio');
  
  if (revealPlayer1Text) revealPlayer1Text.textContent = '';
  if (revealPlayer1Audio) revealPlayer1Audio.src = '';
  
  if (player1AnswerData && player1AnswerData.isAudio) {
    if (revealPlayer1Text) revealPlayer1Text.classList.add('hidden');
    if (revealPlayer1Audio) {
      revealPlayer1Audio.classList.remove('hidden');
      revealPlayer1Audio.src = player1AnswerData.audio;
    }
  } else {
    if (revealPlayer1Audio) revealPlayer1Audio.classList.add('hidden');
    if (revealPlayer1Text) {
      revealPlayer1Text.classList.remove('hidden');
      revealPlayer1Text.textContent = player1AnswerData?.text || player1AnswerData || '';
    }
  }
  
  // Player 2
  const revealPlayer2Initial = document.getElementById('revealPlayer2Initial');
  const revealPlayer2Question = document.getElementById('revealPlayer2Question');
  const revealPlayer2Name = document.getElementById('revealPlayer2Name');
  
  if (revealPlayer2Initial && players[1]?.name) {
    revealPlayer2Initial.textContent = players[1].name[0].toUpperCase();
  }
  if (revealPlayer2Question && players[1]?.id) {
    revealPlayer2Question.textContent = data.questions?.[players[1].id];
  }
  if (revealPlayer2Name && players[1]?.id) {
    revealPlayer2Name.textContent = data.answers?.[players[1].id]?.name;
  }
  
  const player2AnswerData = data.answers?.[players[1]?.id]?.answer;
  const revealPlayer2Text = document.getElementById('revealPlayer2Answer');
  const revealPlayer2Audio = document.getElementById('revealPlayer2Audio');
  
  if (revealPlayer2Text) revealPlayer2Text.textContent = '';
  if (revealPlayer2Audio) revealPlayer2Audio.src = '';
  
  if (player2AnswerData && player2AnswerData.isAudio) {
    if (revealPlayer2Text) revealPlayer2Text.classList.add('hidden');
    if (revealPlayer2Audio) {
      revealPlayer2Audio.classList.remove('hidden');
      revealPlayer2Audio.src = player2AnswerData.audio;
    }
  } else {
    if (revealPlayer2Audio) revealPlayer2Audio.classList.add('hidden');
    if (revealPlayer2Text) {
      revealPlayer2Text.classList.remove('hidden');
      revealPlayer2Text.textContent = player2AnswerData?.text || player2AnswerData || '';
    }
  }
}

function setupTypingListeners() {
  ['player1Answer', 'player2Answer'].forEach(id => {
    const textarea = document.getElementById(id);
    if (!textarea) return;
    
    textarea.addEventListener('input', () => {
      if (
        (currentPlayerId === players[0]?.id && id === 'player1Answer') ||
        (currentPlayerId === players[1]?.id && id === 'player2Answer')
      ) {
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
  console.log('✅ Connected with ID:', currentPlayerId);
  
  // Check URL for room code
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  if (roomCode) {
    const joinGameScreen = document.getElementById('joinGame');
    const gameCodeInput = document.getElementById('gameCode');
    const mainMenu = document.getElementById('mainMenu');
    const joinPlayerNameInput = document.getElementById('joinPlayerName');
    
    if (joinGameScreen) joinGameScreen.classList.remove('hidden');
    if (gameCodeInput) gameCodeInput.value = roomCode;
    if (mainMenu) mainMenu.classList.add('hidden');
    if (joinPlayerNameInput) joinPlayerNameInput.focus();
  }
});

socket.on('gameList', (games) => {
  updateGameList(games);
});

socket.on('gameCreated', (game) => {
  currentGame = game;
  currentRoomCode = game.id;
  const roomCodeEl = document.getElementById('roomCode');
  const inviteLinkDisplay = document.getElementById('inviteLinkDisplay');
  
  if (roomCodeEl) roomCodeEl.textContent = game.id;
  if (inviteLinkDisplay) inviteLinkDisplay.textContent = `${window.location.origin}?room=${game.id}`;
  
  showWaitingRoom();
});

socket.on('joinedGame', (game) => {
  currentGame = game;
});

socket.on('gameStarted', (data) => {
  console.log('🎮 Game started:', data);
  currentGame = data.game;
  players = data.players;
  setupTypingListeners();
  updateGameUI(currentGame);
  showGameScreen();
});

socket.on('playerTyping', (data) => {
  const typingEl = data.playerId === players[0]?.id
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
  console.log('📨 Received round answers:', data);
  showAnswers(data);
});

socket.on('nextRound', (game) => {
  console.log('➡️ Received next round:', game);
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

document.addEventListener('DOMContentLoaded', () => {
  showMainMenu();
});
