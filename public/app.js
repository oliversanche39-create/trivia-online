// ══════════ ESTADO DEL CLIENTE ══════════
const socket = io();
let youId = null;
let myCode = null;
let room = null;
let pickedIndex = null;
let timerInterval = null;
let roundDeadline = 0;
let lastOptions = [];

const $ = id => document.getElementById(id);

// ══════════ NAVEGACIÓN ══════════
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
}

// ══════════ HELPERS DE UI ══════════
function setHostOnly(isHost) {
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !isHost));
  $('lobby-settings').classList.toggle('hidden', isHost);
  $('lobby-settings-edit').classList.toggle('hidden', !isHost);
}

function renderPlayers(players, showScores) {
  const ul = $('players-list');
  ul.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    const wrap = document.createElement('div');
    wrap.textContent = p.name;
    if (p.id === room?.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '👑 host';
      wrap.appendChild(tag);
    }
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = showScores ? p.score + ' pts' : '';
    li.appendChild(wrap);
    li.appendChild(pts);
    ul.appendChild(li);
  });
  $('players-count').textContent = players.length;
}

function renderScoreStrip(players, answeredSet) {
  const strip = $('score-strip');
  strip.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const span = document.createElement('span');
    span.textContent = `${p.name} · ${p.score}`;
    if (answeredSet?.has(p.id)) span.classList.add('answered');
    strip.appendChild(span);
  });
}

function startTimer(seconds) {
  stopTimer();
  roundDeadline = Date.now() + seconds * 1000;
  $('q-timer').textContent = seconds + 's';
  $('timer-bar').style.width = '100%';
  setTimeout(() => { $('timer-bar').style.width = '0%'; }, 50);
  timerInterval = setInterval(() => {
    const left = Math.max(0, Math.ceil((roundDeadline - Date.now()) / 1000));
    $('q-timer').textContent = left + 's';
    if (left <= 0) stopTimer();
  }, 250);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function enableOptions(enable) {
  document.querySelectorAll('.option').forEach(b => b.disabled = !enable);
}

// ══════════ HOME ══════════
$('btn-show-create').onclick = () => { $('create-error').textContent = ''; show('create'); };
$('btn-back-home').onclick = () => show('home');

$('set-questions').oninput = e => $('lbl-questions').textContent = e.target.value;
$('set-time').oninput = e => $('lbl-time').textContent = e.target.value;

$('btn-create').onclick = () => {
  const name = $('create-name').value.trim();
  if (!name) { $('create-error').textContent = 'Poné tu nombre'; return; }
  socket.emit('createRoom', {
    name,
    settings: {
      numQuestions: Number($('set-questions').value),
      timePerQ: Number($('set-time').value),
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

$('btn-start').onclick = () => {
  socket.emit('startGame', { code: myCode });
};

$('set-questions-lobby').oninput = e => {
  $('lbl-questions-lobby').textContent = e.target.value;
  socket.emit('updateSettings', { code: myCode, numQuestions: Number(e.target.value) });
};
$('set-time-lobby').oninput = e => {
  $('lbl-time-lobby').textContent = e.target.value;
  socket.emit('updateSettings', { code: myCode, timePerQ: Number(e.target.value) });
};

function enterLobby(r) {
  room = r;
  myCode = r.code;
  $('lobby-code').textContent = r.code;
  setHostOnly(r.hostId === youId);
  $('btn-start').disabled = r.players.length < 1;
  renderPlayers(r.players, false);
  show('lobby');
}

// ══════════ JUEGO ══════════
document.querySelectorAll('.option').forEach(btn => {
  btn.onclick = () => {
    if (btn.disabled || pickedIndex !== null) return;
    pickedIndex = Number(btn.dataset.idx);
    btn.classList.add('pick');
    enableOptions(false);
    socket.emit('answer', { code: myCode, optionIndex: pickedIndex });
  };
});

function showRound(data) {
  pickedIndex = null;
  lastOptions = data.options;
  $('q-progress').textContent = (data.qIndex + 1) + '/' + data.total;
  $('q-category').textContent = data.category || 'Categoría';
  $('q-text').textContent = data.q;
  $('answered-note').textContent = '';
  document.querySelectorAll('.option').forEach((btn, i) => {
    btn.textContent = data.options[i];
    btn.className = 'option';
    btn.disabled = false;
  });
  renderScoreStrip(data.players);
  show('game');
  startTimer(data.timePerQ);
}

// ══════════ RESULTADO DE RONDA ══════════
function showRoundResults(data) {
  stopTimer();
  $('timer-bar').style.width = '0%';
  // marcar el correcto en la vista del juego antes de cambiar
  document.querySelectorAll('.option').forEach((btn, i) => {
    btn.disabled = true;
    if (i === data.correctIndex) btn.classList.add('correct');
    else if (i === pickedIndex) btn.classList.add('wrong');
  });
  setTimeout(() => {
    $('round-title').textContent = '✅ Respuesta correcta:';
    $('round-answer').textContent = lastOptions[data.correctIndex] || '';
    const ul = $('round-list');
    ul.innerHTML = '';
    [...data.results].sort((a, b) => b.score - a.score).forEach(p => {
      const li = document.createElement('li');
      if (p.id === youId) li.classList.add('me');
      const name = document.createElement('span');
      name.textContent = p.name;
      const pts = document.createElement('span');
      pts.className = 'pts';
      const icon = p.correct === null ? '⏱' : (p.correct ? '✅' : '❌');
      pts.textContent = `${icon} +${p.points} · ${p.score}`;
      li.appendChild(name);
      li.appendChild(pts);
      ul.appendChild(li);
    });
    show('round');
  }, 1200);
}

// ══════════ FIN DE PARTIDA ══════════
function showEnd(standings) {
  const ul = $('end-list');
  ul.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  standings.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === youId) li.classList.add('me');
    const name = document.createElement('span');
    name.textContent = `${medals[i] || (p.rank + '.')} ${p.name}`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = p.score + ' pts';
    li.appendChild(name);
    li.appendChild(pts);
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

socket.on('joinError', msg => {
  $('home-error').textContent = msg;
});

socket.on('roomUpdate', r => {
  if (!room || r.code !== room.code) return;
  room = r;
  if (document.querySelector('#view-lobby.active')) {
    $('lobby-questions').textContent = r.totalQuestions;
    $('lbl-questions-lobby').textContent = r.numQuestions || r.totalQuestions;
    setHostOnly(r.hostId === youId);
    renderPlayers(r.players, false);
    $('btn-start').disabled = r.players.length < 2;
  }
});

socket.on('gameStarted', () => {
  show('game');
  $('q-text').textContent = 'Cargando preguntas…';
  document.querySelectorAll('.option').forEach(b => { b.textContent = ''; b.disabled = true; });
  stopTimer();
});

socket.on('gameError', msg => {
  $('lobby-msg').textContent = msg;
  show('lobby');
});

socket.on('newRound', showRound);

socket.on('playerAnswered', ({ answeredCount, total }) => {
  $('answered-note').textContent = `${answeredCount}/${total} respondieron`;
});

socket.on('roundResults', showRoundResults);

socket.on('gameFinished', ({ standings = [] }) => {
  if (!standings.length) return;
  stopTimer();
  showEnd(standings);
});

socket.on('backToLobby', () => {
  $('lobby-msg').textContent = '';
  show('lobby');
});

socket.on('newHost', ({ newHostName }) => {
  if (newHostName) $('lobby-msg') && console.log('nuevo host:', newHostName);
});

socket.on('playerLeft', () => {});

$('btn-play-again').onclick = () => {
  socket.emit('playAgain', { code: myCode });
};
