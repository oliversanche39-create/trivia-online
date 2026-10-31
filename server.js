const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════ TEMAS (preguntas del PDF del usuario) ══════════
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'themes.json'), 'utf8'));
const THEME_META = {
  calientes:     { label: 'Calientes',              emoji: '🔥' },
  raras:         { label: 'Raras e incómodas',      emoji: '🤨' },
  siono:         { label: 'Sí o No',                emoji: '✅' },
  normal:        { label: 'Contestar normal',       emoji: '💬' },
  calentitas:    { label: 'Calentitas (suaves)',    emoji: '🌶️' },
  muy_calientes: { label: 'Muy calientes y guarras',emoji: '🥵' },
  vida:          { label: 'Vida cotidiana',         emoji: '🏠' },
};

const THEMES = Object.entries(THEME_META).map(([key, m]) => ({
  key, label: m.label, emoji: m.emoji,
  count: (QUESTIONS[key] || []).length,
})).filter(t => t.count > 0);

app.get('/api/themes', (req, res) => {
  res.json(THEMES);
});

// ══════════ ESTADO EN MEMORIA ══════════
const rooms = new Map(); // code -> room
const ROOM_CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODES[Math.floor(Math.random() * ROOM_CODES.length)];
  } while (rooms.has(code));
  return code;
}

const DEFAULTS = { theme: 'calientes', rounds: 15, timePerAnswer: 30 };

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.round(v), min), max);
}

function themeInfo(key) {
  return THEMES.find(t => t.key === key) || THEMES[0];
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, asked: p.asked })),
    state: room.state,
    theme: themeInfo(room.themeKey),
    rounds: room.rounds,
    timePerAnswer: room.timePerAnswer,
  };
}

function roundPayload(room) {
  const target = room.players.find(p => p.id === room.targetId) || null;
  const asker  = room.players.find(p => p.id === room.askerId)  || null;
  return {
    roundNo: room.roundNo,
    totalRounds: room.rounds,
    theme: themeInfo(room.themeKey),
    asker: asker ? { id: asker.id, name: asker.name } : null,
    target: target ? { id: target.id, name: target.name } : null,
    question: room.currentQ || '',
    time: room.timePerAnswer,
    deadline: room.roundDeadline,
    players: room.players.map(p => ({ id: p.id, name: p.name, asked: p.asked })),
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQuestion(themeKey) {
  const pool = QUESTIONS[themeKey];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ══════════ TIMERS ══════════
function clearTimers(room) {
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.nextTimer) { clearTimeout(room.nextTimer); room.nextTimer = null; }
}

// ══════════ SOCKET.IO ══════════
io.on('connection', (socket) => {
  console.log('conn', socket.id);

  socket.on('createRoom', ({ name, settings }) => {
    const code = genCode();
    const room = {
      code, hostId: socket.id, state: 'lobby',
      themeKey: THEME_META[settings?.theme] ? settings.theme : DEFAULTS.theme,
      rounds: clamp(settings?.rounds, 3, 100, DEFAULTS.rounds),
      timePerAnswer: clamp(settings?.timePerAnswer, 0, 180, DEFAULTS.timePerAnswer),
      players: [], roundNo: 0, currentQ: '', askerId: null, targetId: null,
      roundDeadline: 0, roundTimer: null, nextTimer: null,
    };
    const player = { id: socket.id, name: (name || '').trim().slice(0, 20) || 'Anfitrión', asked: 0 };
    room.players.push(player);
    rooms.set(code, room);
    socket.join(code);
    socket.emit('roomCreated', { code, room: publicRoom(room), youId: socket.id });
    io.to(code).emit('roomUpdate', publicRoom(room));
    console.log('sala', code, 'creada por', player.name);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const c = (code || '').toUpperCase().trim();
    const room = rooms.get(c);
    if (!room) { socket.emit('joinError', 'Ese código no existe'); return; }
    if (room.state !== 'lobby') { socket.emit('joinError', 'La partida ya empezó'); return; }
    const clean = (name || '').trim().slice(0, 20);
    if (!clean) { socket.emit('joinError', 'Poné tu nombre'); return; }
    if (room.players.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
      socket.emit('joinError', 'Ese nombre ya está en la sala'); return;
    }
    const player = { id: socket.id, name: clean, asked: 0 };
    room.players.push(player);
    socket.join(c);
    socket.emit('roomJoined', { code: c, room: publicRoom(room), youId: socket.id });
    io.to(c).emit('roomUpdate', publicRoom(room));
    console.log(player.name, 'se unió a', c);
  });

  socket.on('updateSettings', ({ code, theme, rounds, timePerAnswer }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    if (theme && THEME_META[theme]) room.themeKey = theme;
    if (rounds !== undefined) room.rounds = clamp(rounds, 3, 100, room.rounds);
    if (timePerAnswer !== undefined) room.timePerAnswer = clamp(timePerAnswer, 0, 180, room.timePerAnswer);
    io.to(room.code).emit('roomUpdate', publicRoom(room));
  });

  socket.on('startGame', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    if (room.players.length < 2) return;
    room.roundNo = 0;
    room.players.forEach(p => { p.asked = 0; });
    room.state = 'playing';
    console.log('startGame', code, 'tema', room.themeKey, 'jugadores', room.players.length);
    io.to(room.code).emit('gameStarted', roundStartPayload(room));
    dealRound(room);
  });

  // el objetivo confirma que ya respondió
  socket.on('confirmAnswered', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.state !== 'playing' || !room.currentQ) return;
    if (socket.id !== room.targetId) return;
    endRound(room, { confirmed: true });
  });

  // el host saltea la pregunta
  socket.on('skipRound', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'playing' || !room.currentQ) return;
    endRound(room, { skipped: true });
  });

  // el host termina la partida en cualquier momento
  socket.on('endGame', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state === 'finished') return;
    finishGame(room);
  });

  socket.on('playAgain', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'finished') return;
    room.players.forEach(p => { p.asked = 0; });
    room.roundNo = 0;
    room.currentQ = '';
    room.askerId = room.targetId = null;
    room.state = 'lobby';
    io.to(room.code).emit('backToLobby');
    io.to(room.code).emit('roomUpdate', publicRoom(room));
  });

  socket.on('disconnect', () => {
    console.log('disc', socket.id);
    for (const [code, room] of rooms.entries()) {
      if (!room.players.some(p => p.id === socket.id)) continue;
      const wasHost = room.hostId === socket.id;
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(code).emit('playerLeft', { playerId: socket.id });

      if (room.players.length === 0) {
        clearTimers(room);
        rooms.delete(code);
        console.log('sala', code, 'eliminada (vacía)');
        continue;
      }
      if (wasHost) {
        room.hostId = room.players[0].id;
        io.to(code).emit('newHost', { newHostId: room.hostId, newHostName: room.players[0].name });
      }
      io.to(code).emit('roomUpdate', publicRoom(room));

      // si el ronda activa y se fue quien tenía que responder o preguntar, re-repartir
      if (room.state === 'playing' && room.currentQ) {
        const askerGone  = !room.players.some(p => p.id === room.askerId);
        const targetGone = !room.players.some(p => p.id === room.targetId);
        if (targetGone && room.players.length >= 2) {
          dealRound(room, { keepQuestion: true });
        } else if (targetGone || askerGone || room.players.length < 2) {
          endRound(room, { interrupted: true });
        }
      }
    }
  });
});

function roundStartPayload(room) {
  return {
    theme: themeInfo(room.themeKey),
    rounds: room.rounds,
    timePerAnswer: room.timePerAnswer,
    players: room.players.map(p => ({ id: p.id, name: p.name, asked: p.asked })),
  };
}

// reparte la siguiente ronda: el juego elige quién pregunta a quién
function dealRound(room, opts = {}) {
  clearTimers(room);
  if (!opts.keepQuestion) room.roundNo++;
  if (room.roundNo > room.rounds) return finishGame(room);
  if (room.players.length < 2) return finishGame(room);

  if (!opts.keepQuestion || !room.currentQ) room.currentQ = nextQuestion(room.themeKey);

  // objetivo: el que menos veces recibió preguntas, nunca consecutivo (si hay >2)
  const sorted = shuffle([...room.players]).sort((a, b) => a.asked - b.asked);
  let target = sorted[0];
  if (room.players.length > 2 && room.previousTargetId === target.id && sorted.length > 1) {
    target = sorted[1];
  }
  room.targetId = target.id;
  room.previousTargetId = target.id;

  // preguntón: cualquiera menos el objetivo
  const others = room.players.filter(p => p.id !== target.id);
  const asker = others[Math.floor(Math.random() * others.length)];
  room.askerId = asker.id;

  room.roundDeadline = room.timePerAnswer > 0 ? Date.now() + room.timePerAnswer * 1000 : 0;
  room.state = 'playing';
  console.log('dealRound', room.code, 'ronda', room.roundNo, '→', asker.name, 'pregunta a', target.name);
  io.to(room.code).emit('newRound', roundPayload(room));
  if (room.timePerAnswer > 0) {
    room.roundTimer = setTimeout(() => {
      if (rooms.get(room.code) === room && room.state === 'playing') endRound(room, { timeout: true });
    }, room.timePerAnswer * 1000);
  }
}

// cierra la ronda; luego da paso a la siguiente
function endRound(room, { confirmed = false, timeout = false, skipped = false, interrupted = false } = {}) {
  if (room.state !== 'playing') return;
  clearTimers(room);
  const target = room.players.find(p => p.id === room.targetId);
  if (target && (confirmed || timeout)) target.asked++;
  room.state = 'between';
  io.to(room.code).emit('roundEnded', {
    confirmed, timeout, skipped, interrupted,
    targetName: target ? target.name : null,
    roundNo: room.roundNo,
    totalRounds: room.rounds,
    players: room.players.map(p => ({ id: p.id, name: p.name, asked: p.asked })),
  });
  room.currentQ = '';
  room.nextTimer = setTimeout(() => {
    if (rooms.get(room.code) === room && room.state === 'between') dealRound(room);
  }, 5000);
}

function finishGame(room) {
  clearTimers(room);
  room.state = 'finished';
  room.currentQ = '';
  const standings = [...room.players]
    .sort((a, b) => b.asked - a.asked)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, asked: p.asked }));
  io.to(room.code).emit('gameFinished', { standings, code: room.code });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟢 Trivia Online corriendo en http://localhost:${PORT}`);
  console.log(`   Temas: ${THEMES.map(t => `${t.emoji} ${t.label} (${t.count})`).join(' | ')}`);
});
