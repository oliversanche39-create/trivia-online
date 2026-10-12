const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════ ESTADO EN MEMORIA ══════════
const rooms = new Map(); // code -> room
const ROOM_CODES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (sin I, O, 0, 1)

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODES[Math.floor(Math.random() * ROOM_CODES.length)];
  } while (rooms.has(code));
  return code;
}

const DEFAULTS = { numQuestions: 10, timePerQ: 20 };

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    state: room.state,
    numQuestions: room.numQuestions,
    timePerQ: room.timePerQ,
    qIndex: room.qIndex,
    totalQuestions: room.questions ? room.questions.length : room.numQuestions,
  };
}

// ══════════ PREGUNTAS (OpenTDB, gratuito y sin API key) ══════════
// encode=base64 evita peleas con HTML entities; decodificamos a UTF-8
async function fetchQuestions(amount) {
  const url = 'https://opentdb.com/api.php?amount=' + amount + '&type=multiple&encode=base64';
  const r = await fetch(url);
  if (!r.ok) throw new Error('OpenTDB HTTP ' + r.status);
  const j = await r.json();
  if (j.response_code !== 0) throw new Error('OpenTDB response_code=' + j.response_code);
  return j.results.map(item => {
    const correct = b64ToUtf8(item.correct_answer);
    const options = shuffle([correct, ...item.incorrect_answers.map(b64ToUtf8)]);
    return {
      q: b64ToUtf8(item.question),
      options,
      correctIndex: options.indexOf(correct),
      category: b64ToUtf8(item.category || ''),
    };
  });
}

function b64ToUtf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ══════════ SOCKET.IO ══════════
io.on('connection', (socket) => {
  console.log('conn', socket.id);

  // ── Crear sala ──
  socket.on('createRoom', ({ name, settings }) => {
    const code = genCode();
    const room = {
      code, hostId: socket.id, state: 'lobby',
      numQuestions: Math.min(Math.max(Number(settings?.numQuestions) || DEFAULTS.numQuestions, 3), 30),
      timePerQ: Math.min(Math.max(Number(settings?.timePerQ) || DEFAULTS.timePerQ, 5), 60),
      players: [], questions: null, currentQ: null, qIndex: 0,
      answered: new Map(), roundStart: null, roundTimer: null, nextTimer: null,
    };
    const player = { id: socket.id, name: (name || '').trim().slice(0, 20) || 'Anfitrión', score: 0 };
    room.players.push(player);
    rooms.set(code, room);
    socket.join(code);
    socket.emit('roomCreated', { code, room: publicRoom(room), youId: socket.id });
    io.to(code).emit('roomUpdate', publicRoom(room));
    console.log('sala', code, 'creada por', player.name);
  });

  // ── Unirse ──
  socket.on('joinRoom', ({ code, name }) => {
    const c = (code || '').toUpperCase().trim();
    const room = rooms.get(c);
    if (!room) { socket.emit('joinError', 'Ese código no existe'); return; }
    if (room.state !== 'lobby') { socket.emit('joinError', 'La partida ya empezó'); return; }
    const clean = (name || '').trim().slice(0, 20);
    if (room.players.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
      socket.emit('joinError', 'Ese nombre ya está en la sala'); return;
    }
    const player = { id: socket.id, name: clean || 'Jugador', score: 0 };
    room.players.push(player);
    socket.join(c);
    socket.emit('roomJoined', { code: c, room: publicRoom(room), youId: socket.id });
    io.to(c).emit('roomUpdate', publicRoom(room));
    console.log(player.name, 'se unió a', c);
  });

  // ── Cambiar ajustes (solo host, solo en lobby) ──
  socket.on('updateSettings', ({ code, numQuestions, timePerQ }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    room.numQuestions = Math.min(Math.max(Number(numQuestions) || DEFAULTS.numQuestions, 3), 30);
    room.timePerQ = Math.min(Math.max(Number(timePerQ) || DEFAULTS.timePerQ, 5), 60);
    io.to(room.code).emit('roomUpdate', publicRoom(room));
  });

  // ── Empezar partida ──
  socket.on('startGame', async ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    room.state = 'loading';
    io.to(room.code).emit('roomUpdate', publicRoom(room));
    try {
      room.questions = await fetchQuestions(room.numQuestions);
      room.qIndex = -1;
      room.state = 'playing';
      io.to(room.code).emit('gameStarted');
      nextRound(room);
    } catch (e) {
      console.error('fetch questions:', e.message);
      room.state = 'lobby';
      io.to(room.code).emit('gameError', 'No se pudieron traer las preguntas, probá de nuevo en unos segundos.');
      io.to(room.code).emit('roomUpdate', publicRoom(room));
    }
  });

  function nextRound(room) {
    clearTimers(room);
    room.qIndex++;
    if (room.qIndex >= room.questions.length) return endGame(room);
    room.currentQ = room.questions[room.qIndex];
    room.answered = new Map();
    room.roundStart = Date.now();
    io.to(room.code).emit('newRound', {
      qIndex: room.qIndex,
      total: room.questions.length,
      q: room.currentQ.q,
      options: room.currentQ.options,
      category: room.currentQ.category || '',
      timePerQ: room.timePerQ,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });
    room.roundTimer = setTimeout(() => resolveRound(room), room.timePerQ * 1000);
  }

  function clearTimers(room) {
    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
    if (room.nextTimer) { clearTimeout(room.nextTimer); room.nextTimer = null; }
  }

  // ── Respuesta de un jugador ──
  socket.on('answer', ({ code, optionIndex }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.state !== 'playing' || !room.currentQ) return;
    if (room.answered.has(socket.id)) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const elapsed = Date.now() - room.roundStart;
    const remaining = Math.max(0, room.timePerQ * 1000 - elapsed);
    const correct = optionIndex === room.currentQ.correctIndex;
    const points = correct ? 100 + Math.round(900 * (remaining / (room.timePerQ * 1000))) : 0;
    room.answered.set(socket.id, { optionIndex, correct, points });
    player.score += points;
    io.to(room.code).emit('playerAnswered', {
      playerId: socket.id,
      answeredCount: room.answered.size,
      total: room.players.length,
    });
    if (room.answered.size >= room.players.length) resolveRound(room);
  });

  function resolveRound(room) {
    if (!room.currentQ) return;
    clearTimers(room);
    const results = room.players.map(p => {
      const a = room.answered.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        score: p.score,
        correct: a ? a.correct : null,
        points: a ? a.points : 0,
        picked: a ? a.optionIndex : null,
      };
    });
    io.to(room.code).emit('roundResults', {
      correctIndex: room.currentQ.correctIndex,
      results,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });
    room.currentQ = null;
    room.nextTimer = setTimeout(() => {
      if (rooms.get(room.code) === room && room.state === 'playing') nextRound(room);
    }, 4000);
  }

  function endGame(room) {
    clearTimers(room);
    room.state = 'finished';
    room.currentQ = null;
    const standings = [...room.players].sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }));
    io.to(room.code).emit('gameFinished', { standings, code: room.code });
  }

  // ── Revancha (host reinicia) ──
  socket.on('playAgain', ({ code }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.state !== 'finished') return;
    room.players.forEach(p => { p.score = 0; });
    room.qIndex = -1;
    room.questions = null;
    room.state = 'lobby';
    io.to(room.code).emit('backToLobby');
    io.to(room.code).emit('roomUpdate', publicRoom(room));
  });

  // ── Desconexión ──
  socket.on('disconnect', () => {
    console.log('disc', socket.id);
    for (const [code, room] of rooms.entries()) {
      if (!room.players.some(p => p.id === socket.id)) continue;
      const wasHost = room.hostId === socket.id;
      room.players = room.players.filter(p => p.id !== socket.id);
      room.answered.delete(socket.id);
      io.to(code).emit('playerLeft', { playerId: socket.id });
      if (room.players.length === 0) {
        clearTimers(room);
        rooms.delete(code);
        console.log('sala', code, 'eliminada (vacía)');
        continue;
      }
      if (wasHost) {
        const newHost = room.players[0];
        room.hostId = newHost.id;
        io.to(code).emit('newHost', { newHostId: newHost.id, newHostName: newHost.name });
      }
      io.to(code).emit('roomUpdate', publicRoom(room));
      // si era el último que faltaba responder, resolver la ronda
      if (room.state === 'playing' && room.currentQ && room.answered.size >= room.players.length) {
        resolveRound(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟢 Trivia Online corriendo en http://localhost:${PORT}`);
});
