// ══════════ ESTADO DEL CLIENTE ══════════
const socket = io();
let youId = null;
let myCode = null;
let room = null;
let themes = [];
let timerInterval = null;
let betweenInterval = null;

const $ = id => document.getElementById(id);

// ══════════ NAVEGACIÓN ══════════
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
}

// ══════════ HELPERS ══════════
function isHost() {
  return room && room.hostId === youId;
}

function setHostOnly() {
  const host = isHost();
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !host));
}

function timeLabel(sec) {
  return sec > 0 ? sec + 's' : 'Sin límite';
}

function renderPlayers(players, showAsked) {
  const ul = $('players-list');
  ul.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    if (p.id === youId) li.classList.add('me');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    if (room && p.id === room.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '👑';
      nameSpan.appendChild(tag);
    }
    li.appendChild(nameSpan);
    if (showAsked) {
      const tag = document.createElement('span');
      tag.className = 'asked-tag';
      tag.textContent = p.asked + '×';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  });
  $('players-count').textContent = players.length;
}

function stopTimers() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (betweenInterval) { clearInterval(betweenInterval); betweenInterval = null; }
}

function startCountdown(deadline, out) {
  stopTimers();
  const sec = Math.round((deadline - Date.now()) / 1000);
  if (sec <= 0) {
    out.textContent = 'Sin límite';
    $('timer-bar').style.width = '100%';
    return;
  }
  out.textContent = sec + 's';
  $('timer-bar').style.width = '100%';
  setTimeout(() => { $('timer-bar').style.width = '0%'; }, 60);
  const totalMs = deadline - Date.now();
  timerInterval = setInterval(() => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    out.textContent = left + 's';
    $('timer-bar').style.width = Math.max(0, (left * 1000 / totalMs) * 100) + '%';
    if (left <= 0) stopTimers();
  }, 250);
}

// ══════════ TEMAS (GET /api/themes) ══════════
async function loadThemes() {
  try {
    const r = await fetch('/api/themes');
    themes = await r.json();
    if (room) renderThemeGrid();
  } catch { /* reintenta en reload */ }
}
loadThemes();

function renderThemeGrid() {
  const grid = $('theme-grid');
  grid.innerHTML = '';
  themes.forEach(t => {
    const b = document.createElement('button');
    b.className = 'theme-btn' + (room.theme.key === t.key ? ' selected' : '');
    b.innerHTML = `<span class="t-emoji">${t.emoji}</span><span>${t.label}</span><span class="t-count">${t.count} preguntas</span>`;
    if (isHost() && room.state === 'lobby') {
      b.onclick = () => socket.emit('updateSettings', { code: myCode, theme: t.key });
    } else {
      b.disabled = isHost() ? false : true;
      if (!isHost()) b.style.opacity = '.85';
    }
    grid.appendChild(b);
  });
  $('theme-selected').textContent = `${room.theme.emoji} Tema: ${room.theme.label} · ${room.theme.count} preguntas`;
}

// ══════════ HOME ══════════
$('btn-show-create').onclick = () => { $('create-error').textContent = ''; show('create'); };
$('btn-back-home').onclick = () => show('home');

$('set-rounds').oninput = e => $('lbl-rounds').textContent = e.target.value;
function syncTimeLabel() {
  $('lbl-time').textContent = timeLabel(Number($('set-time').value));
}
$('set-time').oninput = syncTimeLabel;
syncTimeLabel();

$('btn-create').onclick = () => {
  const name = $('create-name').value.trim();
  if (!name) { $('create-error').textContent = 'Poné tu nombre'; return; }
  socket.emit('createRoom', {
    name,
    settings: {
      rounds: Number($('set-rounds').value),
      timePerAnswer: Number($('set-time').value),
    },
  });
};

$('btn-join').onclick = () => {
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  if (!code || code.length !== 4) { $('home-error').textContent = 'El código tiene 4 caracteres'; return; }
  if (!name) { $('home-error').textContent = 'Poné tu nombre'; return; }
  socket.emit('joinRoom', { code, name });
};

// ══════════ LOBBY ══════════
$('btn-leave').onclick = () => { location.reload(); };
$('btn-exit').onclick = () => { location.reload(); };
$('btn-start').onclick = () => socket.emit('startGame', { code: myCode });

$('set-rounds-lobby').oninput = e => {
  $('lbl-rounds-lobby').textContent = e.target.value;
  socket.emit('updateSettings', { code: myCode, rounds: Number(e.target.value) });
};
$('set-time-lobby').oninput = e => {
  $('lbl-time-lobby').textContent = timeLabel(Number(e.target.value));
  socket.emit('updateSettings', { code: myCode, timePerAnswer: Number(e.target.value) });
};

function enterLobby(r) {
  room = r;
  myCode = r.code;
  $('lobby-code').textContent = r.code;
  $('lbl-rounds-lobby').textContent = r.rounds;
  $('set-rounds-lobby').value = r.rounds;
  $('lbl-time-lobby').textContent = timeLabel(r.timePerAnswer);
  $('set-time-lobby').value = r.timePerAnswer;
  $('lobby-settings-view').textContent = `${r.theme.emoji} ${r.theme.label} · ${r.rounds} rondas · ${timeLabel(r.timePerAnswer)} para responder`;
  setHostOnly();
  $('btn-start').disabled = r.players.length < 2;
  if (isHost()) {
    $('btn-start').textContent = r.players.length < 2
      ? 'Faltan jugadores (mín. 2)'
      : '▶ Empezar';
  }
  renderThemeGrid();
  renderPlayers(r.players, false);
  show('lobby');
}

function updateLobbyLive(r) {
  room = r;
  if (document.querySelector('#view-lobby.active')) {
    $('lbl-rounds-lobby').textContent = r.rounds;
    $('set-rounds-lobby').value = r.rounds;
    $('lbl-time-lobby').textContent = timeLabel(r.timePerAnswer);
    $('set-time-lobby').value = r.timePerAnswer;
    $('lobby-settings-view').textContent = `${r.theme.emoji} ${r.theme.label} · ${r.rounds} rondas · ${timeLabel(r.timePerAnswer)} para responder`;
    setHostOnly();
    $('btn-start').disabled = r.players.length < 2;
    if (isHost()) {
      $('btn-start').textContent = r.players.length < 2 ? 'Faltan jugadores (mín. 2)' : '▶ Empezar';
    }
    renderThemeGrid();
    renderPlayers(r.players, false);
  }
}

// ══════════ JUEGO ══════════
function showRound(r) {
  stopTimers();
  $('view-game').classList.remove('answer-confirmed', 'answer-timeout');
  $('deal-asker').textContent = r.asker?.name ?? '—';
  $('deal-target').textContent = r.target?.name ?? '—';
  $('deal-help').textContent = r.asker && r.target
    ? `${r.asker.name} hace la pregunta y ${r.target.name} contesta`
    : 'preparando la ronda…';
  $('q-progress').textContent = `Ronda ${r.roundNo}/${r.totalRounds}`;
  $('q-theme').textContent = `${r.theme.emoji} ${r.theme.label}`;
  $('q-text').textContent = r.question;

  // zona de respuesta: solo el objetivo confirma
  const isTarget = r.target && r.target.id === youId;
  $('btn-answered').classList.toggle('hidden', !isTarget);
  $('btn-answered').disabled = false;
  $('waiting-note').textContent = isTarget
    ? 'Respondé en voz alta y confirmá 👇'
    : r.target ? `Esperando que ${r.target.name} responda…` : '';

  $('q-timer').textContent = timeLabel(r.time);
  if (r.time > 0 && r.deadline) startCountdown(r.deadline, $('q-timer'));
  else { stopTimers(); $('timer-bar').style.width = '100%'; }

  renderStrip(r.players);
  show('game');
}

function renderStrip(players) {
  const strip = $('score-strip');
  strip.innerHTML = '';
  players.forEach(p => {
    const span = document.createElement('span');
    span.textContent = `${p.name} · ${p.asked}×`;
    if (p.id === youId) span.style.color = 'var(--green)';
    strip.appendChild(span);
  });
}

$('btn-answered').onclick = () => {
  if ($('btn-answered').disabled) return;
  $('btn-answered').disabled = true;
  socket.emit('confirmAnswered', { code: myCode });
};

$('btn-skip').onclick = () => socket.emit('skipRound', { code: myCode });
$('btn-finish').onclick = () => {
  if (confirm('¿Terminar la partida ahora?')) socket.emit('endGame', { code: myCode });
};

// fin de ronda → banner + cuenta atrás hasta la siguiente
socket.on('roundEnded', ({ confirmed, timeout, skipped, interrupted, targetName, players }) => {
  stopTimers();
  $('q-timer').textContent = '—';
  $('timer-wrap').style.display = 'none';
  $('btn-answered').classList.add('hidden');
  const view = $('view-game');
  view.classList.remove('answer-confirmed', 'answer-timeout');
  if (confirmed) view.classList.add('answer-confirmed');
  if (timeout) view.classList.add('answer-timeout');

  let msg;
  if (skipped) msg = '✔ Pregunta saltada';
  else if (confirmed) msg = `✅ ${targetName ?? 'El objetivo'} respondió`;
  else if (timeout) msg = `⏱ Se acabó el tiempo para ${targetName ?? 'el objetivo'}`;
  else if (interrupted) msg = '↺ Se reorganizó la ronda';
  else msg = '✔ Ronda cerrada';

  $('deal-help').textContent = msg;
  $('waiting-note').textContent = '';
  document.querySelectorAll('.host-controls').forEach(el => el.classList.add('hidden'));

  renderStrip(players);

  let left = 5;
  $('waiting-note').textContent = `Siguiente pregunta en ${left}…`;
  betweenInterval = setInterval(() => {
    left--;
    $('waiting-note').textContent = left > 0 ? `Siguiente pregunta en ${left}…` : 'Siguiente pregunta…';
    if (left <= 0) clearInterval(betweenInterval);
  }, 1000);
});

// ══════════ FIN DE PARTIDA ══════════
function showEnd(standings) {
  stopTimers();
  $('timer-wrap').style.display = 'none';
  const ul = $('end-list');
  ul.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  standings.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === youId) li.classList.add('me');
    const name = document.createElement('span');
    name.textContent = `${medals[i] || (p.rank + '.')} ${p.name}`;
    const tag = document.createElement('span');
    tag.className = 'asked-tag';
    tag.textContent = p.asked + '×';
    li.appendChild(name);
    li.appendChild(tag);
    ul.appendChild(li);
  });
  show('end');
}

// ══════════ EVENTOS DEL SERVIDOR ══════════
socket.on('connect', () => { youId = socket.id; });

socket.on('roomCreated', ({ code, room: r, youId: y }) => {
  youId = y;
  enterLobby(r);
});

socket.on('roomJoined', ({ room: r, youId: y }) => {
  youId = y;
  enterLobby(r);
});

socket.on('joinError', msg => { $('home-error').textContent = msg; });

socket.on('roomUpdate', r => {
  if (!room || r.code !== room.code) return;
  room = r;
  updateLobbyLive(r);
});

socket.on('gameStarted', () => {
  show('game');
  stopTimers();
  $('q-text').textContent = 'Cargando la primera pregunta…';
  $('deal-asker').textContent = '—';
  $('deal-target').textContent = '—';
  $('deal-help').textContent = 'el juego está eligiendo quién pregunta a quién…';
  $('btn-answered').classList.add('hidden');
  $('waiting-note').textContent = '';
});

socket.on('newRound', r => {
  $('timer-wrap').style.display = '';
  if (isHost()) document.querySelectorAll('.host-controls').forEach(el => el.classList.remove('hidden'));
  showRound(r);
});

socket.on('gameError', msg => {
  stopTimers();
  $('lobby-msg').textContent = msg;
  show('lobby');
});

socket.on('gameFinished', ({ standings = [] }) => {
  if (!standings.length) return;
  showEnd(standings);
});

socket.on('backToLobby', () => {
  stopTimers();
  show('lobby');
});

socket.on('newHost', () => {
  setHostOnly();
});

socket.on('playerLeft', () => {});

$('btn-play-again').onclick = () => {
  socket.emit('playAgain', { code: myCode });
};
