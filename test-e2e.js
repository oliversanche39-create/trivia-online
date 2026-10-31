// Prueba e2e del juego: host + guest contra un servidor (local o producción)
// Recolectores creados ANTES de emitir: sin carreras de registro de listeners
const { io } = require('socket.io-client');

const URL = process.argv[2] || (process.env.REMOTE ? 'https://trivia-online-5ylo.onrender.com' : 'http://localhost:3000');
console.log('→ probando contra', URL);

const TOTAL_ROUNDS = 3;
let ok = true;
const check = (cond, msg) => {
  console.log((cond ? '  OK  ' : '  FAIL ') + msg);
  if (!cond) ok = false;
};

function client() {
  return io(URL, { transports: ['websocket', 'polling'], reconnection: false, timeout: 15000 });
}

// recolector: acumula eventos y espera el primero que cumpla un predicado
function collector(cl, event) {
  const buf = [];
  const waiting = [];
  cl.on(event, data => {
    for (let i = 0; i < waiting.length; i++) {
      const { pred, res } = waiting[i];
      try { if (pred(data)) { waiting.splice(i, 1); res(data); return; } } catch { }
    }
    buf.push(data);
  });
  const waitFor = (pred, ms = 15000) => new Promise((resolve, reject) => {
    for (let i = 0; i < buf.length; i++) {
      try {
        if (pred(buf[i])) { const d = buf[i]; buf.splice(i, 1); return resolve(d); }
      } catch { }
    }
    waiting.push({ pred, res: resolve });
    setTimeout(() => reject(new Error('timeout esperando ' + event)), ms);
  });
  return { waitFor, buf };
}

async function main() {
  const host = client();
  const guest = client();

  await Promise.all([
    new Promise(r => host.once('connect', r)),
    new Promise(r => guest.once('connect', r)),
  ]);

  const C = {
    created: collector(host, 'roomCreated'),
    joinedG: collector(guest, 'roomJoined'),
    updH: collector(host, 'roomUpdate'),
    startH: collector(host, 'gameStarted'),
    startG: collector(guest, 'gameStarted'),
    newRoundG: collector(guest, 'newRound'),
    endH: collector(host, 'roundEnded'),
    endG: collector(guest, 'roundEnded'),
    finH: collector(host, 'gameFinished'),
    finG: collector(guest, 'gameFinished'),
    backH: collector(host, 'backToLobby'),
    backG: collector(guest, 'backToLobby'),
  };

  // 1) crear sala
  host.emit('createRoom', {
    name: 'Anfitrión',
    settings: { rounds: TOTAL_ROUNDS, timePerAnswer: 5 },
  });
  const { code, room: r0, youId } = await C.created.waitFor(d => d.code, 15000);
  check(youId === host.id, 'recibido youId del host');
  check(r0.rounds === TOTAL_ROUNDS, 'rondas guardadas');
  check(r0.timePerAnswer === 5, 'tiempo por respuesta guardado');

  // 2) unirse
  guest.emit('joinRoom', { code, name: 'Invitado' });
  await C.joinedG.waitFor(d => d.code === code, 15000);
  const upJoin = await C.updH.waitFor(d => d.players && d.players.length === 2, 15000);
  check(upJoin.code === code, 'host ve la sala con 2 jugadores');

  // 3) cambiar tema
  host.emit('updateSettings', { code, theme: 'siono', rounds: TOTAL_ROUNDS, timePerAnswer: 0 });
  const up = await C.updH.waitFor(d => d.theme && d.theme.key === 'siono', 15000);
  check(up.theme.key === 'siono', 'tema cambiado a siono');

  // 4) empezar · 3 rondas · cada ronda la confirma su objetivo
  host.emit('startGame', { code });
  await Promise.all([C.startH.waitFor(() => true), C.startG.waitFor(() => true)]);
  console.log('  OK  gameStarted en ambos');

  const seenTargets = new Set();
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    const nr = await C.newRoundG.waitFor(d => d.roundNo, 20000);
    check(nr.roundNo === i, `ronda ${i} llegó (roundNo=${nr.roundNo})`);
    check(nr.theme.key === 'siono', 'tema correcto en la ronda');
    check(typeof nr.question === 'string' && nr.question.length > 10, 'pregunta con texto');
    check(nr.asker && nr.target, 'asker y target asignados');
    check(nr.asker.id !== nr.target.id, 'el que pregunta no responde');
    check(nr.time === 0, 'sin límite de tiempo reflejado');
    seenTargets.add(nr.target.id);

    // confirma quien sea el objetivo; esperamos roundEnded en cualquiera
    const targetCl = nr.target.id === host.id ? host : guest;
    targetCl.emit('confirmAnswered', { code });
    await Promise.race([
      C.endH.waitFor(d => d.roundNo === i && d.confirmed),
      C.endG.waitFor(d => d.roundNo === i && d.confirmed),
    ]);
    console.log(`  OK  ronda ${i} cerrada por confirmación`);
  }
  check(seenTargets.size === 2, 'ambos jugadores recibieron preguntas');

  // 5) fin de partida automático
  const fin = await Promise.race([
    C.finH.waitFor(d => d.standings && d.standings.length === 2, 10000),
    C.finG.waitFor(d => d.standings && d.standings.length === 2, 10000),
  ]);
  check(fin && fin.standings.length === 2, 'podio final con ambos');

  // 6) revancha
  host.emit('playAgain', { code });
  await Promise.all([
    C.backH.waitFor(() => true),
    C.backG.waitFor(() => true),
    C.updH.waitFor(d => d.state === 'lobby', 15000),
  ]);
  console.log('  OK  revancha: backToLobby + roomUpdate recibidos');

  host.close();
  guest.close();
  console.log(ok ? '\nTEST OK' : '\nTEST FALLO');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
