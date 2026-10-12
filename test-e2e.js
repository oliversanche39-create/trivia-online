// Prueba end-to-end del juego de trivia
// npm i socket.io-client y luego node test-e2e.js
const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

function once(sock, ev, timeout = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout esperando ' + ev)), timeout);
    sock.once(ev, d => { clearTimeout(t); res(d); });
  });
}

async function main() {
  console.log('→ conectando jugadores falsos…');
  const host = io(URL);
  const guest = io(URL);
  let questions = 0;
  let answers = 0;
  let results = 0;
  let finished = false;

  host.on('newRound', d => {
    questions++;
    console.log(`P${d.qIndex + 1}/${d.total}: ${d.q.slice(0, 70)}…`);
    const pick = Math.floor(Math.random() * d.options.length);
    setTimeout(() => host.emit('answer', { code: hostState.code, optionIndex: pick }), 500 + Math.random() * 1500);
  });
  host.on('roundResults', () => results++);
  host.on('gameFinished', ({ standings }) => {
    finished = true;
    console.log('\n✔ Partida terminada. Podio:');
    standings.forEach(s => console.log(`  ${s.rank}. ${s.name} — ${s.score} pts`));
    console.log(`\nStats: ${questions} preguntas, ${results} rondas resueltas`);
    const ok = questions >= 3 && results === questions && finished;
    console.log(ok ? '✔✔ TEST OK' : '✘ TEST FALLÓ');
    process.exit(ok ? 0 : 1);
  });

  const hostState = { code: null };
  // (necesitamos el código antes; guardamos referencia mutables)
  host.on('newRound', d => { /* usa hostState.code */ });
  guest.on('newRound', d => {
    const pick = Math.floor(Math.random() * d.options.length);
    setTimeout(() => guest.emit('answer', { code: guestState.code, optionIndex: pick }), 800 + Math.random() * 2000);
  });

  const guestState = { code: null };

  await once(host, 'connect');
  await once(guest, 'connect');

  console.log('→ host crea sala…');
  host.emit('createRoom', { name: 'HostBot', settings: { numQuestions: 5, timePerQ: 10 } });
  const created = await once(host, 'roomCreated');
  hostState.code = created.code;
  console.log('  código:', created.code);

  console.log('→ guest se une…');
  guest.emit('joinRoom', { code: created.code, name: 'GuestBot' });
  await once(guest, 'roomJoined');
  console.log('  guest unido');

  console.log('→ host arranca partida…');
  host.emit('startGame', { code: created.code });
  const finEv = once(host, 'gameFinished', 120000);
  await finEv;
}

main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
