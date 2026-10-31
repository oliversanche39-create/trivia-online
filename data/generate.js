// ══════════════════════════════════════════════════════════════════
//  Generador de packs de preguntas - Trivia Online
//  Determinístico: mismo seed → mismo resultado (parcheable)
//  Dedupe estricto por texto. Target: 1000 por pack.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const TARGET = 1000;

// ── RNG determinístico (mulberry32) ──
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeInt(rng) { return (n) => Math.floor(rng() * n); }

// Helper: todas las combinaciones de lists[0] × lists[1] × ... barajadas
function combos(rng, lists) {
  let out = [[]];
  for (const list of lists) {
    const next = [];
    for (const pre of out) for (const item of list) next.push([...pre, item]);
    out = next;
  }
  // barajar con Fisher–Yates usando rng determinístico
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Helper: aplicar plantilla a una combinación de slots (tokens [{A}, ...])
function fill(template, tuple) {
  return template.replace(/\{(\d+)\}/g, (_, i) => tuple[Number(i)]);
}

// Helper: expandir plantillas hasta llenar target con dedupe
function expand(rng, templates, target) {
  const seen = new Set();
  const out = [];
  let guardMax = target * 20;
  while (out.length < target && guardMax-- > 0) {
    // elegir plantilla round-robin ponderada por "capacidad restante"
    const t = templates[Math.floor(rng() * templates.length)];
    const tuples = combos(rng, t.slots);
    const base = Math.ceil(target / templates.length);
    const take = tuples.slice(0, Math.max(base, 20));
    for (const tpl of take) {
      if (out.length >= target) break;
      const q = fill(t.text, tpl).trim();
      if (q.length < 12) continue;
      const key = q.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
    if (tuples.every(x => seen.has(fill(t.text, x).toLowerCase().trim()))) {
      templates = templates.filter(x => x !== t);
      if (!templates.length) break;
    }
  }
  // barajar el resultado final (orden estable por seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  LISTAS REUTILIZABLES
// ══════════════════════════════════════════════════════════════════
const S = {
  cuerpo:   ['los labios', 'el cuello', 'la oreja', 'la espalda', 'el pecho', 'el abdomen', 'la cintura', 'los muslos', 'las manos', 'la nuca', 'la clavícula', 'los hombros', 'el ombligo', 'la rodilla', 'el interior del codo', 'la mejilla', 'la sien', 'la voz', 'las piernas', 'el olor del pelo'],
  accion:   ['un masaje lento', 'apagar la luz', 'derretir hielo en la piel', 'una mirada fija a los ojos', 'susurrar al oído', 'una cena a la luz de velas', 'bailar pegados sin música', 'una noche de hotel solo capitalized', 'besos en la lluvia', 'jugar con plumas', 'un baño de espuma', 'un vino en la bañera', 'amarra con pañuelos de seda', 'morder suavemente', 'una pijamada solo-adultos'],
  donde:    ['en un jacuzzi', 'en el auto', 'en la playa de noche', 'en un ascensor', 'en una ducha', 'en la cocina', 'en una azotea', 'en un camping', 'en la biblioteca', 'en un cine vacío', 'en el sofá', 'bajo la ducha', 'en un hotel caro', 'en el suelo de la sala', 'en la bañera', 'en un mirador', 'en el balcón', 'en una cueva', 'en la arena', 'en un ascensor lleno'],
  persona:  ['tu ex', 'tu crush actual', 'el/la último/a que te escribió', 'una persona atrapada de ti misma', 'tu primer amor', 'alguien famoso que conozcas solo de nombre', 'un desconocido encantador', 'tu mejor amigx del pasillo', 'la persona que ves en el espejo', 'un antiguo maestro', 'tu vecinx misteriosx', 'quien te ganó el último juego', 'una celebrity con la que soñaste'],
  sujeto2:  ['tu ex', 'tu crush actual', 'un famoso', 'quien te debe dinero', 'el/la que te lastimó', 'tu vecinx', 'un desconocido', 'tu amistad más vieja', 'un ex de tu ex', 'el/la último/a que besaste'],
  rare:     ['cuando nada importa', 'si nadie te ve', 'por dinero suficiente', 'si te pagan un año sin internet', 'si no hay consecuencias', 'si estás aburridx un domingo', 'si mañana se acaba el mundo', 'con solo un witness digital', 'si te lo pide tu mascota telepáticamente', 'en un universo paralelo'],
  tema:     ['la historia de tu peor cita', 'el secreto que cuentas siendo anónimx', 'tu mayor miedo a la medianoche', 'esa canción que solo oyes para llorar', 'la cosa más tonta que compraste', 'tu momento más vergonzoso en vivo', 'el plan que arruinaste sin querer', 'el amor no resuelto que mas te duele'],
  tema2:    ['un programa reconfortante', 'un olor de la infancia', 'una comida que te devuelve a la niñez', 'la canción del primer amor', 'el videojuego más tengo-que-volver'],
  raro:     ['una escalera infinita', 'un pasillo con luces rojas', 'un room que no existe购房', 'la sandía verde la madrugada', 'un corredor en loop', 'la luz parpadeando 3 veces exacto', 'un reloj sin manecillas mostrando las 7:07', 'la puerta sin extremo'],
};

// ══════════════════════════════════════════════════════════════════
//  PACK 1: CALIENTES (abiertas) — pícante, sugerente, no explícito
// ══════════════════════════════════════════════════════════════════
function packCaliente() {
  const rng = makeRng(1337);
  const int = makeInt(rng);
  const templates = [
    { text: '¿Dónde te gusta más que te den un masaje lento y por qué esa parte antes que otra? Puedes describir la sensación sin tapujos.', slots: [] },
    { text: 'Si tuvieras que recrear una escena icónica con {0}, ¿cuál eliges: besarte {1} o apagar las luces y dejarte explorar?', slots: [S.persona, S.donde], count: 200 },
    { text: '¿Cuál es el pensamiento más caliente que has tenido {1} y aún no le has contado a nadie?', slots: [S.donde, S.rare], count: 200 },
    { text: 'Elegí un/a {0} para jugar una noche solo-a-dos: describe qué harías primero, qué después y qué jamás intentarías con esa persona.', slots: [S.persona], count: 150 },
    { text: 'Entre un masaje con hielo, un baño de espuma a la luz de una vela, o ser atadxs con seda suave… ¿qué experimentarías {1} y por qué?', slots: [S.donde, S.donde], count: 150 },
    { text: 'Cuéntanos tu fantasía más perturbadora-con-encanto que involucre a {0} y que no te atreviste a mencionar nunca en voz alta.', slots: [S.persona], count: 150 },
    { text: 'Si pudieras anochecer con cualquier persona real o ficticia la noche entera sin que se entere el mundo, ¿a quién eliges y qué jugarías primero: susurros o mirada fija?', slots: [], count: 100 },
    { text: '¿Qué parte de tu cuerpo hay que observar {1} para entender algo de ti que las palabras no revelan? Sé honesta/o: es parte terapéutica de este pack.', slots: [S.donde, S.donde], count: 150 },
  ];
  return expand(rng, templates, TARGET);
}

// ══════════════════════════════════════════════════════════════════
//  PACK 2: RARAS / INCÓMODAS (abiertas)
// ══════════════════════════════════════════════════════════════════
function packRaro() {
  const rng = makeRng(4242);
  const int = makeInt(rng);
  const templates = [
    { text: '¿Qué harías ahora mismo si estuvieras {1} y a la vez obligadx a confesar tu peor momento vergonzoso en vivo?', slots: [S.rare, S.rare], count: 150 },
    { text: 'Describe con detalle qué vé tu {0} cuando le darezas a alguien de tu escala más secreta.', slots: [], count: 50 },
    { text: 'Something is watching you {1} since {0}. Name it and say why you carry it instead of hiding it.', slots: [S.rare, S.rare], count: 50 },
    { text: '¿Cuál es la mentira que has mantenido más tiempo hacia {0} sin que nadie lo sospeche? Compártela aquí y suelta ese peso.', slots: [S.persona], count: 100 },
    { text: '¿Has soñado {0} con {1}? Describe la escena exacta y qué dejó en ti al despertar.', slots: [S.rare, S.persona], count: 100 },
    { text: 'Cuando rhymes the universe asks you {0}, how do you answer without lying to yourself? Dinos tu versión honesta.', slots: [S.rare], count: 25 },
    { text: 'What is the one thing you would do tomorrow {1} even knowing you cannot tell anyone? Explain why it matters.', slots: [S.rare], count: 50 },
    { text: '¿Cuál es el hábito que sabes que es extra-o pero sigues haciendo {1} cuando crees que nadie lo nota? Dinos su origen.', slots: [S.rare], count: 50 },
    { text: '¿Qué sonaría tu despedida {1}? Escribe las primeras dos líneas que dirías.', slots: [S.rare], count: 100 },
    { text: 'Confesar algo a {0} sin que lo repita nadie: ¿qué elegirías y cómo te cambiaría el peso? Compártelo aquí, somos un solo grupo hoy.', slots: [S.persona], count: 200 },
    { text: '¿Cuál es el objeto más raro que conservas por razones que te dan vergüenza admitir? Cuenta su historia.', slots: [], count: 100 },
    { text: '¿Tienes una persona que sabes que nunca te bajará la guardia del todo? ¿Por qué elegiste darle esa distancia?', slots: [], count: 100 },
    { text: 'Name a sound you can instantly reproduce with your mouth that makes people uncomfortable. Illustrate why it always lands.', slots: [], count: 50 },
    { text: '¿Cuál es el detalle de tu cuerpo que más te perturba en las fotos y a la vez te da carácter? Habla de él con cariño-complicado.', slots: [], count: 100 },
  ];
  return expand(rng, templates, TARGET);
}

// ══════════════════════════════════════════════════════════════════
//  PACK 3: NORMALES (abiertas) — para relajarse y charlar
// ══════════════════════════════════════════════════════════════════
function packNormal() {
  const rng = makeRng(2026);
  const templates = [
    { text: '¿Cuál es la anécdota detrás de tu álbum de fotos menos esperado {1}? Cuéntala con detalle sin acortar la vergüenza.', slots: [S.tema2, S.donde], count: 100 },
    { text: 'Describe tu plan perfecto para un día libre empezando a las 11:00 y terminando desapercibido. ¿Qué dread', slots: [], count: 100 },
    { text: 'Si pudieras dominar una habilidad {1} sin esfuerzo, ¿cuál eliges y cuál sería el primer uso ridículo que le darías?', slots: [S.donde, S.rare], count: 100 },
    { text: '¿Cuál es tu canción oficial {1} y desde cuándo la elegiste? Cuéntanos qué sucede cuando la reproducen sin querer.', slots: [S.tema2, S.donde], count: 150 },
    { text: 'Compra inesperada que te alegró la semana ¿qué fue {1} y por qué sigue siendo importante para ti?', slots: [S.donde, S.donde], count: 100 },
    { text: '¿Qué hace tu familia {1} que al ajenos les parece raro? Comparte el detalle y por qué no lo cambiarías.', slots: [S.donde, S.donde], count: 150 },
    { text: 'If you had to pack {1} for an unplanned trip {0}, what objects define tu estilo de viaje y por qué?', slots: [S.persona, S.donde], count: 150 },
    { text: 'Potrero secreto: ¿cuál es tu lugar favorite para desconectar y por qué celebras que no lo hayan viralizado todavía?', slots: [], count: 100 },
    { text: '¿Qué trick simple aprendiste {1} que cambió tu rutina para siempre? Explica cómo lo descubriste.', slots: [S.donde, S.donde], count: 150 },
  ];
  return expand(rng, templates, TARGET);
}

// ══════════════════════════════════════════════════════════════════
//  PACK 4: NORMALES SÍ/NO (bool)
// ══════════════════════════════════════════════════════════════════
function packNormalYN() {
  const rng = makeRng(9090);
  const templates = [
    { text: '¿Comprarías {0} {1} aunque no lo necesites?', slots: [S.normalBuy, S.donde], count: 200 },
    { text: '¿Sabrías cocinar para diez personas {1} sin receta externa?', slots: [S.donde, S.rare], count: 200 },
    { text: '¿Dejarías {0} {1} sin pensarlo?', slots: [S.persona, S.donde], count: 200 },
    { text: '¿Dormirías {1} con una persona desconocida ruidosa a la par?', slots: [S.donde], count: 200 },
    { text: '¿Volverías a {1} sabiendo el final desde ahora?', slots: [S.rare], count: 200 },
    { text: '¿Cantarías en público {1} si tu crush está mirando desde afuera?', slots: [S.donde], count: 200 },
  ];
  return expand(rng, templates, TARGET);
}

// ══════════════════════════════════════════════════════════════════
//  PACK 5: MUY CALIENTES SÍ/NO (bool)
// ══════════════════════════════════════════════════════════════════
function packCalienteYN() {
  const rng = makeRng(6789);
  const templates = [
    { text: '¿Besarias a {0} {1} si estuvieran solos hoy?', slots: [S.persona, S.donde], count: 250 },
    { text: '¿Aceptarías un masaje {1} de {0} sin pedirlo tú?', slots: [S.donde, S.persona], count: 250 },
    { text: '¿Dormirías en la misma cama a {1} con un crush que solo portas de nombre?', slots: [S.donde], count: 150 },
    { text: '¿Quitarías {1} el primer botón de tu camisa para alguien que te gusta? (Resto responses en privado)', slots: [S.donde], count: 200 },
    { text: '¿Mandarías una foto {1} a tu crush sabiendo que la borrara después? (Solo la idea, no lo hagamos aquí).', slots: [S.donde], count: 150 },
  ];
  return expand(rng, templates, TARGET);
}

// ══════════════════════════════════════════════════════════════════
//  LISTAS auxiliares para YN packs
// ══════════════════════════════════════════════════════════════════
S.normalBuy = [
  'un gadget absurdo', 'una consola que ya tenías', 'un instrumento que no tocas', 'una bici eléctrica', '500 stickers de tu anime favorito',
  'la edición de lujo de tu libro favorito', 'un robot-aspirador chiquito', 'una lámpara de galaxia', 'un proyector para el techo', 'un robot de cocina',
  'un aeroclip para zapatos', 'una mini-estufa para el escritorio', 'un set de velas aromáticas', 'un tee del merch de tu banda', 'una silla gaming premium',
  'una máquina de palomitas', 'un kit para hacer helado en casa', 'una头皮 spa casera', 'unics de lujo para tu mascota', 'una jarron de acuario virtual',
];

// ══════════════════════════════════════════════════════════════════
//  BUILD
// ══════════════════════════════════════════════════════════════════
const packs = {
  'caliente':     { label: '🔥 Calientes',           type: 'open', questions: packCaliente() },
  'raro':         { label: '👻 Raras r/incomodas',    type: 'open', questions: packRaro() },
  'normal':       { label: '💬 Normales',            type: 'open', questions: packNormal() },
  'normal-yn':    { label: '🤔 Normales Sí/No',       type: 'bool', questions: packNormalYN() },
  'caliente-yn':  { label: '🥵 Calientes Sí/No',      type: 'bool', questions: packCalienteYN() },
};

const dir = __dirname;
for (const [id, p] of Object.entries(packs)) {
  if (p.questions.length !== TARGET) {
    console.error(`⚠️ pack ${id} tiene ${p.questions.length} preguntas (faltan ${TARGET - p.questions.length})`);
  }
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ id, label: p.label, type: p.type, questions: p.questions }, null, 0), 'utf8');
  const uniq = new Set(p.questions.map(q => q.toLowerCase())).size;
  console.log(`✔ ${file} — ${p.questions.length} preguntas (${uniq} únicas por lowercase)`);
}
console.log('\nListo: 5 packs en data/');
