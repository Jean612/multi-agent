/**
 * office.js — Escena pixel-art de la "Pixel Agents Office" en <canvas>.
 * 100% nativo: cero dependencias, cero imágenes externas (todo con fillRect).
 *
 * Regla clave: NO se accede a `window`, `document` ni a ninguna API del DOM a
 * nivel de módulo; todo el acceso al DOM vive dentro de `createOffice()`, para
 * que `import('ui/office.js')` funcione también en Node (tests).
 */

/** Ancho interno del canvas (píxeles lógicos). */
export const INTERNAL_WIDTH = 320;
/** Alto interno del canvas (píxeles lógicos). */
export const INTERNAL_HEIGHT = 180;
/** Tamaño de un tile en píxeles lógicos. */
export const TILE = 16;
/** Identificadores de los escritorios/agentes, en orden visual. */
export const DESK_IDS = ['planner', 'coder', 'qa'];

/** Color del brillo de pantalla de cada monitor (mismos que --accent/--amber/--cyan). */
const AGENT_COLORS = {
  planner: '#4cc2ff',
  coder: '#ffb84c',
  qa: '#62e3e3',
};

/** Paleta de colores de la escena (solo strings, sin DOM). */
const PALETTE = {
  wall: '#2b3550',
  baseboard: '#1a2132',
  floorA: '#5d4226',
  floorB: '#523a21',
  floorGrain: '#453117',
  deskTop: '#8a6238',
  deskEdge: '#6b4a28',
  chair: '#33415e',
  chairDark: '#26334a',
  monitorCase: '#11161f',
  monitorStand: '#0b0f16',
  shelf: '#6b4a28',
  bookA: '#4cc2ff',
  bookB: '#ffb84c',
  bookC: '#62e3e3',
  coffee: '#39414f',
  coffeeDark: '#232936',
  pot: '#7a4a2e',
  leafA: '#3f9e4d',
  leafB: '#2f7d3b',
};

/**
 * Construye el mapa estático de la oficina (función pura, sin DOM).
 * @returns {{
 *   cols: number,
 *   rows: number,
 *   tiles: string[][],
 *   props: Array<{type: string, col: number, row: number, w: number, h: number, id?: string}>,
 *   desks: Array<{id: string, col: number, row: number}>,
 * }}
 */
export function buildOfficeMap() {
  const cols = INTERNAL_WIDTH / TILE; // 20
  const rows = Math.ceil(INTERNAL_HEIGHT / TILE); // 12 (la última fila queda recortada)

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    const line = [];
    for (let col = 0; col < cols; col++) {
      if (row === 0) line.push('wall');
      else if (row === 1) line.push('baseboard');
      else line.push('floor');
    }
    tiles.push(line);
  }

  /** @type {Array<{id: string, col: number, row: number}>} */
  const desks = [
    { id: 'planner', col: 3, row: 5 },
    { id: 'coder', col: 9, row: 5 },
    { id: 'qa', col: 15, row: 5 },
  ];

  const props = [
    { type: 'bookshelf', col: 1, row: 0, w: 2, h: 2 },
    { type: 'coffee', col: 9, row: 1, w: 1, h: 1 },
    { type: 'plant', col: 18, row: 1, w: 1, h: 1 },
    { type: 'plant', col: 0, row: 10, w: 1, h: 1 },
  ];
  for (const desk of desks) {
    props.push({ type: 'monitor', col: desk.col, row: desk.row - 1, w: 2, h: 1, id: desk.id });
    props.push({ type: 'desk', col: desk.col, row: desk.row, w: 2, h: 1, id: desk.id });
    props.push({ type: 'chair', col: desk.col, row: desk.row + 1, w: 1, h: 1, id: desk.id });
  }

  return { cols, rows, tiles, props, desks };
}

/** Media query de la vista mixta ancha (franja de tarjetas al costado del canvas); igual a la de index.html. */
export const SIDE_BY_SIDE_QUERY = '(min-width: 1101px)';

/**
 * Calcula el factor de escala CSS del canvas, nítido en píxeles físicos: cada píxel lógico
 * ocupa un número entero de píxeles de pantalla (con dpr 2, 1.5× CSS = 3 px físicos).
 * @param {number} availableWidth Ancho disponible en px CSS.
 * @param {number} availableHeight Alto disponible en px CSS.
 * @param {number} [dpr] devicePixelRatio; 1 si no es un número finito > 0.
 * @returns {number} Escala >= 1; 1 si el espacio no es un número finito > 0.
 */
export function computeScale(availableWidth, availableHeight, dpr = 1) {
  if (
    !Number.isFinite(availableWidth) || !Number.isFinite(availableHeight) ||
    availableWidth <= 0 || availableHeight <= 0
  ) {
    return 1;
  }
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const fit = Math.min(availableWidth / INTERNAL_WIDTH, availableHeight / INTERNAL_HEIGHT);
  return Math.max(1, Math.floor(fit * ratio) / ratio);
}

// ==============================================================================
// Datos puros de estados, poses y animación (sin DOM)
// ==============================================================================

/** Estados de escena que produce updatePixelOffice() en index.html. */
export const SCENE_STATES = ['idle', 'planning', 'code', 'fix', 'qa', 'approved', 'changes_required'];

/** Poses disponibles: nº de frames, duración de cada frame (ms) y desplazamiento vertical por frame. */
export const POSES = {
  idle:    { frames: 2, frameMs: 600, dy: [0, 1] },          // respira (baja 1 px)
  typing:  { frames: 2, frameMs: 120, dy: [0, 0] },          // alterna mano izquierda/derecha
  inspect: { frames: 4, frameMs: 200, dy: [0, 0, 0, 0] },    // lupa barre de izquierda a derecha
  alert:   { frames: 2, frameMs: 150, dy: [0, 0] },          // brazos arriba + sacudida horizontal
  jump:    { frames: 4, frameMs: 120, dy: [0, -3, -5, -3] }, // salto de festejo con brazos arriba
  walk:    { frames: 2, frameMs: 150, dy: [0, -1] },          // caminata: rebote de 1 px
};

/** Tabla de poses por estado de escena y escritorio (refleja las clases CSS de updatePixelOffice). */
const POSE_TABLE = {
  idle:             { planner: 'idle', coder: 'idle',   qa: 'idle'    },
  planning:         { planner: 'typing', coder: 'idle', qa: 'idle'    },
  code:             { planner: 'idle', coder: 'typing', qa: 'idle'    },
  fix:              { planner: 'idle', coder: 'typing', qa: 'idle'    },
  qa:               { planner: 'idle', coder: 'idle',   qa: 'inspect' },
  approved:         { planner: 'jump', coder: 'jump',   qa: 'jump'    },
  changes_required: { planner: 'idle', coder: 'idle',   qa: 'alert'   },
};

/**
 * Devuelve el nombre de la pose de un agente para un estado de escena.
 * Entradas desconocidas devuelven 'idle'.
 * @param {string} sceneState Estado de escena (ver SCENE_STATES).
 * @param {string} deskId Identificador del escritorio (ver DESK_IDS).
 * @returns {string} Nombre de pose (clave de POSES).
 */
export function poseFor(sceneState, deskId) {
  if (!SCENE_STATES.includes(sceneState) || !DESK_IDS.includes(deskId)) return 'idle';
  return POSE_TABLE[sceneState][deskId];
}

/**
 * Devuelve el índice de frame de una pose en un instante dado.
 * @param {string} pose Nombre de la pose.
 * @param {number} timeMs Instante en milisegundos.
 * @param {boolean} [reducedMotion] Si es true, siempre devuelve 0.
 * @returns {number} Índice de frame (0 si la pose o el tiempo no son válidos).
 */
export function frameIndexAt(pose, timeMs, reducedMotion = false) {
  const def = POSES[pose];
  if (reducedMotion || !def || !Number.isFinite(timeMs)) return 0;
  return Math.floor(timeMs / def.frameMs) % def.frames;
}

// ==============================================================================
// Sprites procedurales: mapas de caracteres (sin imágenes externas)
// ==============================================================================

/** Plantilla base del agente (de espaldas, sentado). '.' = transparente. */
const AGENT_BASE = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '...HHHHHHHHHH...',
  '...HHHHHHHHHH...',
  '...SHHHHHHHHS...',
  '....HHHHHHHH....',
  '......SSSS......',
  '...BBBBBBBBBB...',
  '..BBBBBBBBBBBB..',
  '..BBBBBBBBBBBB..',
  '.DBBBBBBBBBBBBD.',
  '.DBBBBBBBBBBBBD.',
  '.DBBBBBBBBBBBBD.',
  '.SBBBBBBBBBBBBS.',
  '..BBBBBBBBBBBB..',
  '..DDDDDDDDDDDD..',
  '..PPPPPPPPPPPP..',
  '..PPPPPPPPPPPP..',
  '..PPPP....PPPP..',
  '..PPPP....PPPP..',
  '..KKKK....KKKK..',
  '..KKKK....KKKK..',
];

const SHARED = { S: '#f1c7a0', P: '#2b3550', K: '#151a24', L: '#c0c8d8', G: '#bff6ff' };

/** Paletas por agente: cada una define todas las letras del sprite salvo '.'. */
export const AGENT_PALETTES = {
  planner: { ...SHARED, H: '#d8dee9', B: '#4cc2ff', D: '#2a7fb0' }, // Argon: pelo canoso, azul
  coder:   { ...SHARED, H: '#ff8a3d', B: '#ffb84c', D: '#b97a22' }, // OpenCode: gorra naranja, ámbar
  qa:      { ...SHARED, H: '#2b2b3a', B: '#62e3e3', D: '#2f9f9f' }, // Kimi: pelo oscuro, cian
};

/** Reemplaza un carácter del sprite (los strings son inmutables). */
function setPixel(rows, row, col, ch) {
  rows[row] = rows[row].slice(0, col) + ch + rows[row].slice(col + 1);
}

/** Dibuja los brazos levantados (lo usan 'alert' y 'jump'). */
function raiseArms(rows) {
  for (let r = 12; r <= 15; r++) {
    setPixel(rows, r, 1, '.');
    setPixel(rows, r, 14, '.');
  }
  for (let r = 5; r <= 8; r++) {
    setPixel(rows, r, 1, 'D');
    setPixel(rows, r, 14, 'D');
  }
  setPixel(rows, 4, 1, 'S');
  setPixel(rows, 4, 14, 'S');
}

/**
 * Genera el sprite de un agente para una pose y frame dados (función pura).
 * @param {string} pose Nombre de la pose (las desconocidas se tratan como 'idle').
 * @param {number} frame Índice de frame (se normaliza con módulo).
 * @returns {{rows: string[], dx: number, dy: number}} Filas de 16 caracteres y desplazamiento.
 */
export function buildAgentSprite(pose, frame) {
  if (!POSES[pose]) pose = 'idle';
  const def = POSES[pose];
  const n = def.frames;
  const f = ((frame % n) + n) % n;

  const rows = [...AGENT_BASE];
  const dy = def.dy[f] ?? 0;
  const dx = pose === 'alert' ? (f === 0 ? -1 : 1) : 0;

  if (pose === 'typing') {
    // Mano alterna arriba: izquierda en frame 0, derecha en frame 1.
    const col = f === 0 ? 1 : 14;
    setPixel(rows, 15, col, 'D');
    setPixel(rows, 13, col, 'S');
  } else if (pose === 'alert' || pose === 'jump') {
    raiseArms(rows);
  } else if (pose === 'inspect') {
    // Lupa de 4×4 sobre el hombro derecho, barriendo de izquierda a derecha.
    const c0 = [9, 10, 11, 10][f];
    for (let c = c0; c <= c0 + 3; c++) {
      setPixel(rows, 9, c, 'L');
      setPixel(rows, 12, c, 'L');
    }
    for (let r = 10; r <= 11; r++) {
      setPixel(rows, r, c0, 'L');
      setPixel(rows, r, c0 + 3, 'L');
      setPixel(rows, r, c0 + 1, 'G');
      setPixel(rows, r, c0 + 2, 'G');
    }
    setPixel(rows, 13, 13, 'S'); // mano que sostiene la lupa
    setPixel(rows, 14, 14, 'D'); // manga
  }

  return { rows, dx, dy };
}

// ==============================================================================
// Director de escena: transiciones y coreografías de entrega (puro, sin DOM)
// ==============================================================================

/** Tipos de coreografía que puede disparar un cambio de estado de escena. */
export const TRANSITIONS = ['handoff-plan', 'handoff-code', 'return-fix', 'celebrate'];

/**
 * Detecta la coreografía para el paso prev → next (ambos estados de escena).
 * @param {string|null} prev Estado activo previo (puede ser null).
 * @param {string} next Estado nuevo.
 * @returns {string|null} Un valor de TRANSITIONS o null.
 */
export function detectTransition(prev, next) {
  if (!SCENE_STATES.includes(next) || prev === next) return null;
  if (next === 'approved') return 'celebrate';
  if (prev === 'planning' && next === 'code') return 'handoff-plan';
  if ((prev === 'code' || prev === 'fix' || prev === 'changes_required') && next === 'qa') {
    return 'handoff-code';
  }
  if (prev === 'qa' && (next === 'changes_required' || next === 'fix')) return 'return-fix';
  return null;
}

/** y (px) del pasillo, debajo de las sillas. */
export const LANE_Y = 112;
/** Velocidad de caminata en px por segundo. */
export const WALK_SPEED = 60;
/** Pausa al entregar (ms). */
export const HANDOFF_HOLD_MS = 400;
/** Duración de 'celebrate' en ms (sin caminata). */
export const CELEBRATE_MS = 1200;
/** Máximo de coreografías en espera. */
export const MAX_PENDING = 2;

/**
 * Interpola linealmente un camino de keyframes { t, x, y } en un instante dado.
 * @param {Array<{t: number, x: number, y: number}>} path Keyframes con t creciente, empezando en 0.
 * @param {number} elapsedMs Instante en ms.
 * @returns {{x: number, y: number}} Posición con coordenadas enteras.
 */
export function interpolatePath(path, elapsedMs) {
  const first = path[0];
  const last = path[path.length - 1];
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { x: first.x, y: first.y };
  if (elapsedMs >= last.t) return { x: last.x, y: last.y };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (elapsedMs >= a.t && elapsedMs <= b.t) {
      const span = b.t - a.t;
      const k = span === 0 ? 0 : (elapsedMs - a.t) / span;
      return { x: Math.round(a.x + (b.x - a.x) * k), y: Math.round(a.y + (b.y - a.y) * k) };
    }
  }
  return { x: last.x, y: last.y };
}

/** Rutas de entrega: actor, target y objeto de cada tipo de caminata. */
const CHOREO_ROUTES = {
  'handoff-plan': { actor: 'planner', target: 'coder', prop: 'scroll' },
  'handoff-code': { actor: 'coder', target: 'qa', prop: 'box' },
  'return-fix': { actor: 'qa', target: 'coder', prop: 'box' },
};

/**
 * Construye una coreografía con waypoints fijos (función pura, sin pathfinding).
 * @param {string} type Un valor de TRANSITIONS.
 * @param {object} [map] Mapa de la oficina (por defecto buildOfficeMap()).
 * @returns {{type: string, actor: string|null, target: string|null, prop: string|null,
 *   duration: number, dropT: number, path: Array<{t: number, x: number, y: number}>}|null}
 */
export function buildChoreography(type, map = buildOfficeMap()) {
  if (type === 'celebrate') {
    return { type, actor: null, target: null, prop: null, duration: CELEBRATE_MS, dropT: 0, path: [] };
  }
  const route = CHOREO_ROUTES[type];
  if (!route) return null;

  const deskOf = (id) => map.desks.find((d) => d.id === id);
  const A = agentAnchor(deskOf(route.actor));
  const T = agentAnchor(deskOf(route.target));
  const ms = (d) => Math.round((d / WALK_SPEED) * 1000);

  // Se para al costado del target, del lado desde el que llega.
  const standX = A.x < T.x ? T.x - 14 : T.x + 14;
  const t1 = ms(LANE_Y - A.y); // baja del asiento al pasillo
  const t2 = t1 + ms(Math.abs(standX - A.x)); // recorre el pasillo
  const t3 = t2 + HANDOFF_HOLD_MS; // pausa de entrega
  const t4 = t3 + (t2 - t1); // vuelta por el pasillo
  const t5 = t4 + t1; // se sienta de nuevo
  const path = [
    { t: 0, x: A.x, y: A.y },
    { t: t1, x: A.x, y: LANE_Y },
    { t: t2, x: standX, y: LANE_Y },
    { t: t3, x: standX, y: LANE_Y },
    { t: t4, x: A.x, y: LANE_Y },
    { t: t5, x: A.x, y: A.y },
  ];
  return {
    type,
    actor: route.actor,
    target: route.target,
    prop: route.prop,
    duration: t5,
    dropT: t2 + Math.round(HANDOFF_HOLD_MS / 2),
    path,
  };
}

/**
 * Director de escena: convierte estados en coreografías encoladas.
 * Compara contra el último estado ACTIVO (≠ 'idle') para tolerar los 'idle'
 * momentáneos que la UI ve entre pasos del loop (code → idle → qa).
 * Puro: recibe `now` siempre como argumento.
 * @param {string} [initialState] Estado de escena inicial.
 */
export function createSceneDirector(initialState = 'idle') {
  const map = buildOfficeMap();
  let lastActive = SCENE_STATES.includes(initialState) && initialState !== 'idle' ? initialState : null;
  /** @type {{choreo: object, startedAt: number}|null} */
  let current = null;
  /** @type {object[]} */
  let pending = [];

  /**
   * Registra un nuevo estado de escena y encola la coreografía que corresponda.
   * Los estados inválidos y los 'idle' momentáneos se ignoran.
   * @returns {string|null} El tipo de transición detectada (valor de TRANSITIONS) o null.
   */
  function push(next, now) {
    void now;
    if (!SCENE_STATES.includes(next) || next === 'idle') return null;
    const type = detectTransition(lastActive, next);
    lastActive = next;
    if (type) {
      pending.push(buildChoreography(type));
      while (pending.length > MAX_PENDING) pending.shift(); // descarta las más viejas
    }
    return type;
  }

  /** Avanza la cola: cierra la coreografía terminada y arranca la siguiente. */
  function tick(now) {
    if (current && now - current.startedAt >= current.choreo.duration) current = null;
    if (!current && pending.length) current = { choreo: pending.shift(), startedAt: now };
    return current?.choreo.type ?? null;
  }

  /** Salta al estado final: vacía la coreografía en curso y la cola. No toca lastActive. */
  function skipToEnd() {
    current = null;
    pending = [];
  }

  /** Devuelve una foto del instante: posición, pose y objeto del actor en caminata. */
  function snapshot(now) {
    if (!current) return null;
    const elapsed = now - current.startedAt;
    const c = current.choreo;
    if (c.actor === null) {
      return { type: c.type, actor: null, x: 0, y: 0, pose: null, prop: null, emotes: emotesAt(c, elapsed) };
    }
    const pos = interpolatePath(c.path, elapsed);
    const holding = elapsed >= c.path[2].t && elapsed < c.path[3].t;
    const pose = holding ? 'idle' : 'walk';
    let prop;
    if (elapsed < c.dropT) {
      prop = { kind: c.prop, x: pos.x + 11, y: pos.y + 12 }; // en la mano
    } else {
      const T = agentAnchor(map.desks.find((d) => d.id === c.target));
      prop = { kind: c.prop, x: T.x + 5, y: T.y + 1 }; // sobre el escritorio del target
    }
    return { type: c.type, actor: c.actor, x: pos.x, y: pos.y, pose, prop, emotes: emotesAt(c, elapsed) };
  }

  /** Devuelve una copia de los tipos de coreografía en espera. */
  function getPending() {
    return pending.map((c) => c.type);
  }

  /** Devuelve el último estado activo (≠ 'idle'). */
  function getLastActive() {
    return lastActive;
  }

  return { push, tick, skipToEnd, snapshot, getPending, getLastActive };
}

// ==============================================================================
// Emotes, confeti y jingle (puro, sin DOM)
// ==============================================================================

/** Emotes disponibles. */
export const EMOTES = ['alert', 'angry', 'coffee', 'love'];
/** Duración de un emote en ms. */
export const EMOTE_MS = 900;

/** Filas 1–6 (interior) de cada globo de emote; las filas 0 y 7–9 son comunes. */
const EMOTE_INTERIORS = {
  alert:  ['OWWWRWWWO', 'OWWWRWWWO', 'OWWWRWWWO', 'OWWWRWWWO', 'OWWWWWWWO', 'OWWWRWWWO'],
  angry:  ['OWRRWRRWO', 'OWRWWWRWO', 'OWWWWWWWO', 'OWRWWWRWO', 'OWRRWRRWO', 'OWWWWWWWO'],
  coffee: ['OWWTWTWWO', 'OWWWTWTWO', 'OWCCCCWWO', 'OWCCCCCWO', 'OWCCCCWWO', 'OWWCCWWWO'],
  love:   ['OWRRWRRWO', 'OWRRRRRWO', 'OWRRRRRWO', 'OWWRRRWWO', 'OWWWRWWWO', 'OWWWWWWWO'],
};

/** Paleta compartida de los globos de emote. */
const EMOTE_PALETTE = { O: '#151a24', W: '#f4f1e8', R: '#e04848', C: '#7a4a2e', T: '#c0c8d8' };

/**
 * Construye el sprite de un emote (globo de 9×10).
 * @param {string} kind Un valor de EMOTES.
 * @returns {{rows: string[], palette: Record<string,string>}|null} null si kind no está en EMOTES.
 */
export function buildEmoteSprite(kind) {
  const interior = EMOTE_INTERIORS[kind];
  if (!interior) return null;
  return {
    rows: ['.OOOOOOO.', ...interior, '.OOOWOOO.', '...OWO...', '....O....'],
    palette: EMOTE_PALETTE,
  };
}

/**
 * Agenda de emotes de una coreografía (tiempos relativos a su inicio, ms, enteros).
 * @param {object|null} choreo Resultado de buildChoreography.
 * @returns {Array<{desk: string, kind: string, start: number, end: number}>}
 */
export function buildEmoteSchedule(choreo) {
  if (!choreo) return [];
  const clip = (ms) => Math.min(ms, choreo.duration);
  switch (choreo.type) {
    case 'handoff-plan':
      return [
        { desk: choreo.target, kind: 'alert', start: choreo.dropT, end: clip(choreo.dropT + EMOTE_MS) },
      ];
    case 'handoff-code':
      return [
        { desk: choreo.target, kind: 'alert', start: choreo.dropT, end: clip(choreo.dropT + EMOTE_MS) },
        { desk: choreo.actor, kind: 'coffee', start: choreo.path[4].t, end: choreo.duration },
      ];
    case 'return-fix':
      return [
        { desk: choreo.actor, kind: 'angry', start: 0, end: clip(EMOTE_MS) },
        { desk: choreo.target, kind: 'alert', start: choreo.dropT, end: clip(choreo.dropT + EMOTE_MS) },
      ];
    case 'celebrate':
      return DESK_IDS.map((desk) => ({ desk, kind: 'love', start: 0, end: clip(CELEBRATE_MS) }));
    default:
      return [];
  }
}

/** Emotes visibles en `elapsedMs` (start <= t < end). [] si choreo es null o t no es finito. */
export function emotesAt(choreo, elapsedMs) {
  if (!choreo || !Number.isFinite(elapsedMs)) return [];
  return buildEmoteSchedule(choreo)
    .filter((e) => elapsedMs >= e.start && elapsedMs < e.end)
    .map((e) => ({ desk: e.desk, kind: e.kind }));
}

/** Nº de partículas de confeti. */
export const CONFETTI_COUNT = 48;
/** Duración del confeti en ms. */
export const CONFETTI_MS = 2600;
/** Gravedad del confeti en px/s². */
export const CONFETTI_GRAVITY = 120;
/** Colores del confeti. */
export const CONFETTI_COLORS = ['#4cc2ff', '#ffb84c', '#62e3e3', '#34d378', '#ff5b5b', '#f4f1e8'];

/** PRNG mulberry32: devuelve () => número en [0, 1). Mismo seed → misma secuencia. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Crea las partículas de confeti (determinista por seed).
 * @returns {Array<{x0: number, y0: number, vx: number, vy: number, color: string, size: number, phase: number}>}
 */
export function createConfetti(seed = 1, count = CONFETTI_COUNT) {
  const rng = createRng(seed);
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x0: Math.floor(rng() * INTERNAL_WIDTH),
      y0: -2 - Math.floor(rng() * 40),
      vx: (rng() - 0.5) * 30,
      vy: 10 + rng() * 30,
      color: CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)],
      size: rng() < 0.5 ? 1 : 2,
      phase: rng() * Math.PI * 2,
    });
  }
  return particles;
}

/** Posiciones enteras visibles en elapsedMs; [] si elapsedMs < 0, no finito o >= CONFETTI_MS. */
export function confettiAt(particles, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= CONFETTI_MS) return [];
  const t = elapsedMs / 1000;
  const visible = [];
  for (const p of particles) {
    const x = Math.round(p.x0 + p.vx * t + 2 * Math.sin(t * 6 + p.phase));
    const y = Math.round(p.y0 + p.vy * t + 0.5 * CONFETTI_GRAVITY * t * t);
    if (x >= 0 && x < INTERNAL_WIDTH && y >= 0 && y < INTERNAL_HEIGHT) {
      visible.push({ x, y, color: p.color, size: p.size });
    }
  }
  return visible;
}

/** Arpegio Do mayor ascendente (C5 E5 G5 C6). start/dur en segundos. */
export const JINGLE_NOTES = [
  { freq: 523.25, start: 0, dur: 0.11 },
  { freq: 659.25, start: 0.12, dur: 0.11 },
  { freq: 783.99, start: 0.24, dur: 0.11 },
  { freq: 1046.5, start: 0.36, dur: 0.32 },
];
/** Ganancia máxima del jingle. */
export const JINGLE_GAIN = 0.05;

/**
 * Programa el jingle sobre un AudioContext (o un doble de test con la misma forma).
 * @returns {number} Nº de notas programadas (0 si ac es falsy).
 */
export function scheduleJingle(ac, notes = JINGLE_NOTES) {
  if (!ac) return 0;
  for (const note of notes) {
    const t = ac.currentTime + note.start;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(note.freq, t);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(JINGLE_GAIN, t + 0.01);
    g.gain.linearRampToValueAtTime(0, t + note.dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t);
    osc.stop(t + note.dur + 0.02);
  }
  return notes.length;
}

// ==============================================================================
// Dibujo procedural (solo fillRect con coordenadas enteras)
// ==============================================================================

/** Pinta un tile de pared. */
function drawWallTile(ctx, x, y) {
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(x, y, TILE, TILE);
}

/** Pinta un tile de zócalo (parte baja de la pared). */
function drawBaseboardTile(ctx, x, y) {
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = PALETTE.baseboard;
  ctx.fillRect(x, y + TILE - 4, TILE, 4);
}

/** Pinta un tile de piso de madera alternando dos tonos, con veta de 1 px. */
function drawFloorTile(ctx, x, y, variant) {
  ctx.fillStyle = variant ? PALETTE.floorB : PALETTE.floorA;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = PALETTE.floorGrain;
  ctx.fillRect(x, y + 7, TILE, 1);
}

/** Pinta un escritorio de 2×1 tiles. */
function drawDesk(ctx, x, y) {
  ctx.fillStyle = PALETTE.deskTop;
  ctx.fillRect(x, y + 2, TILE * 2, 6);
  ctx.fillStyle = PALETTE.deskEdge;
  ctx.fillRect(x, y + 8, TILE * 2, 2);
  // Patas.
  ctx.fillRect(x + 1, y + 10, 2, 6);
  ctx.fillRect(x + TILE * 2 - 3, y + 10, 2, 6);
}

/** Pinta una silla de 1×1 tile, centrada en el hueco de 2 tiles del escritorio. */
function drawChair(ctx, x, y) {
  const cx = x + TILE / 2; // centrada bajo el escritorio
  ctx.fillStyle = PALETTE.chairDark;
  ctx.fillRect(cx + 2, y, 8, 3); // respaldo
  ctx.fillStyle = PALETTE.chair;
  ctx.fillRect(cx + 1, y + 3, 10, 6); // asiento
  ctx.fillStyle = PALETTE.chairDark;
  ctx.fillRect(cx + 3, y + 9, 2, 5); // pie izquierdo
  ctx.fillRect(cx + 7, y + 9, 2, 5); // pie derecho
}

/** Pinta un monitor de 2×1 tiles con brillo de pantalla del color del agente. */
function drawMonitor(ctx, x, y, id) {
  const glow = AGENT_COLORS[id] || '#9aa7c7';
  ctx.fillStyle = PALETTE.monitorCase;
  ctx.fillRect(x + 2, y, TILE * 2 - 4, 10);
  ctx.fillStyle = glow;
  ctx.fillRect(x + 4, y + 2, TILE * 2 - 8, 6);
  ctx.fillStyle = PALETTE.monitorStand;
  ctx.fillRect(x + TILE - 2, y + 10, 4, 3);
  ctx.fillRect(x + TILE - 5, y + 13, 10, 2);
}

/** Pinta una estantería de 2×2 tiles con lomos de libro de 3 colores. */
function drawBookshelf(ctx, x, y) {
  const w = TILE * 2;
  const h = TILE * 2;
  ctx.fillStyle = PALETTE.shelf;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PALETTE.deskEdge;
  ctx.fillRect(x + 1, y + h / 2 - 1, w - 2, 2); // balda intermedia
  const books = [PALETTE.bookA, PALETTE.bookB, PALETTE.bookC];
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = books[i % books.length];
    ctx.fillRect(x + 3 + i * 5, y + 4, 3, 10); // fila superior
    ctx.fillRect(x + 3 + i * 5, y + h / 2 + 4, 3, 9); // fila inferior
  }
}

/** Pinta una máquina de café de 1×1 tile. */
function drawCoffee(ctx, x, y) {
  ctx.fillStyle = PALETTE.coffee;
  ctx.fillRect(x + 3, y + 3, 10, 11);
  ctx.fillStyle = PALETTE.coffeeDark;
  ctx.fillRect(x + 5, y + 5, 6, 3);
  ctx.fillRect(x + 6, y + 10, 4, 3); // taza
}

/** Pinta una planta de 1×1 tile (maceta + hojas de dos tonos). */
function drawPlant(ctx, x, y) {
  ctx.fillStyle = PALETTE.leafB;
  ctx.fillRect(x + 4, y + 1, 3, 6);
  ctx.fillStyle = PALETTE.leafA;
  ctx.fillRect(x + 7, y, 4, 8);
  ctx.fillRect(x + 2, y + 3, 3, 5);
  ctx.fillStyle = PALETTE.pot;
  ctx.fillRect(x + 4, y + 9, 8, 6);
}

const TILE_DRAWERS = {
  wall: drawWallTile,
  baseboard: drawBaseboardTile,
  floor: drawFloorTile,
};

const PROP_DRAWERS = {
  desk: (ctx, x, y) => drawDesk(ctx, x, y),
  chair: (ctx, x, y) => drawChair(ctx, x, y),
  monitor: (ctx, x, y, prop) => drawMonitor(ctx, x, y, prop.id),
  bookshelf: (ctx, x, y) => drawBookshelf(ctx, x, y),
  coffee: (ctx, x, y) => drawCoffee(ctx, x, y),
  plant: (ctx, x, y) => drawPlant(ctx, x, y),
};

/** Pinta la escena estática completa (tiles + props) sobre un contexto 2D. */
function renderStaticScene(ctx, map) {
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const draw = TILE_DRAWERS[map.tiles[row][col]];
      if (draw) draw(ctx, col * TILE, row * TILE, (col + row) % 2);
    }
  }
  for (const prop of map.props) {
    const draw = PROP_DRAWERS[prop.type];
    if (draw) draw(ctx, prop.col * TILE, prop.row * TILE, prop);
  }
}

/** Pinta un sprite (mapa de caracteres) con la paleta del agente; '.' no se pinta. */
function drawSprite(ctx, rows, palette, x, y) {
  let lastColor = null;
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      const color = palette[ch];
      if (!color) continue;
      if (color !== lastColor) {
        ctx.fillStyle = color;
        lastColor = color;
      }
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
}

/** Posición (esquina superior izquierda) del agente sentado frente a su escritorio. */
export function agentAnchor(desk) {
  return { x: desk.col * TILE + 8, y: (desk.row + 1) * TILE + 9 - 24 };
}

/** Pinta el objeto entregado (pergamino o caja) con fillRect y enteros. */
function drawProp(ctx, kind, x, y) {
  if (kind === 'scroll') {
    ctx.fillStyle = '#f3e2b3';
    ctx.fillRect(x, y, 6, 4); // cuerpo
    ctx.fillStyle = '#c9a86a';
    ctx.fillRect(x, y, 1, 4); // punta izquierda
    ctx.fillRect(x + 5, y, 1, 4); // punta derecha
    ctx.fillStyle = '#d94a4a';
    ctx.fillRect(x + 2, y + 1, 2, 2); // sello
  } else if (kind === 'box') {
    ctx.fillStyle = '#a0703a';
    ctx.fillRect(x, y, 6, 5); // cuerpo
    ctx.fillStyle = '#7a5228';
    ctx.fillRect(x, y, 6, 1); // tapa
    ctx.fillStyle = '#e8d8a8';
    ctx.fillRect(x + 2, y, 2, 5); // cinta
  }
}

/** Pinta un emote (globo de 9×10) sobre la cabeza de un agente. */
function drawEmote(ctx, kind, x, y) {
  const emote = buildEmoteSprite(kind);
  if (!emote) return;
  drawSprite(ctx, emote.rows, emote.palette, x, y);
}

/**
 * Monta la oficina pixel-art sobre un <canvas> existente.
 * @param {HTMLCanvasElement} canvas Canvas destino.
 * @param {{host?: HTMLElement}} [options] `host` opcional para medir el espacio disponible.
 * @returns {{render: Function, resize: Function, destroy: Function, setScene: Function,
 *   setSoundEnabled: Function, isSoundEnabled: Function, unlockAudio: Function,
 *   playJingle: Function, map: object}|null}
 *   `null` si el canvas no ofrece contexto 2D (sin lanzar excepciones).
 */
export function createOffice(canvas, options = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;

  canvas.width = INTERNAL_WIDTH;
  canvas.height = INTERNAL_HEIGHT;
  ctx.imageSmoothingEnabled = false;

  const map = buildOfficeMap();

  // Capa estática prerenderizada una sola vez: el bucle solo hace drawImage + sprites.
  const staticLayer = document.createElement('canvas');
  staticLayer.width = INTERNAL_WIDTH;
  staticLayer.height = INTERNAL_HEIGHT;
  const staticCtx = staticLayer.getContext('2d');
  staticCtx.imageSmoothingEnabled = false;
  renderStaticScene(staticCtx, map);

  const host = options.host ?? canvas.closest('.pixel-office') ?? canvas.parentElement;

  // Estado de escena inicial: el módulo carga después del primer updatePixelOffice.
  let sceneState = SCENE_STATES.includes(host?.dataset?.sceneState) ? host.dataset.sceneState : 'idle';
  const director = createSceneDirector(sceneState);

  // Accesibilidad: sin animación si el usuario pidió reduced-motion.
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  let reducedMotion = !!motionQuery?.matches;

  // Confeti y sonido (el sonido está apagado por defecto; el AudioContext es perezoso).
  let confetti = [];
  let confettiStart = null;
  let soundEnabled = false;
  let audioCtx = null;

  /** Crea/reanuda el AudioContext. Llamar dentro de un gesto del usuario. */
  function unlockAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audioCtx = new AC();
      } catch {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume?.().catch?.(() => {});
    return audioCtx;
  }

  function setSoundEnabled(on) {
    soundEnabled = !!on;
  }

  function isSoundEnabled() {
    return soundEnabled;
  }

  function playJingle() {
    if (!soundEnabled) return;
    const ac = unlockAudio();
    if (!ac) return;
    try {
      scheduleJingle(ac);
    } catch {
      /* audio no disponible: silencio */
    }
  }

  function render(now = performance.now()) {
    director.tick(now);
    const snap = director.snapshot(now);
    ctx.drawImage(staticLayer, 0, 0);
    // Primero los sentados y después el que camina, para que el del pasillo quede por delante.
    for (const pass of ['seated', 'walker']) {
      for (const desk of map.desks) {
        const walking = snap?.actor === desk.id;
        if ((pass === 'walker') !== walking) continue;
        let pose;
        let x;
        let y;
        if (walking) {
          pose = snap.pose;
          x = snap.x;
          y = snap.y;
        } else {
          pose = poseFor(sceneState, desk.id);
          const a = agentAnchor(desk);
          x = a.x;
          y = a.y;
        }
        const frame = frameIndexAt(pose, now, reducedMotion);
        const sprite = buildAgentSprite(pose, frame);
        const dx = reducedMotion || walking ? 0 : sprite.dx;
        const dy = reducedMotion ? 0 : sprite.dy;
        drawSprite(ctx, sprite.rows, AGENT_PALETTES[desk.id], x + dx, y + dy);
      }
    }
    if (snap?.prop) drawProp(ctx, snap.prop.kind, snap.prop.x, snap.prop.y);
    // Emotes sobre la cabeza del agente (el caminante usa su posición actual).
    for (const e of snap?.emotes ?? []) {
      let bx;
      let by;
      if (snap.actor === e.desk) {
        bx = snap.x;
        by = snap.y;
      } else {
        const desk = map.desks.find((d) => d.id === e.desk);
        if (!desk) continue;
        const a = agentAnchor(desk);
        bx = a.x;
        by = a.y;
      }
      drawEmote(ctx, e.kind, bx + 3, Math.max(0, by - 11));
    }
    // Confeti al final: queda por encima de todo.
    if (confettiStart !== null) {
      const elapsed = now - confettiStart;
      if (elapsed >= CONFETTI_MS) {
        confettiStart = null;
        confetti = [];
      } else {
        for (const p of confettiAt(confetti, elapsed)) {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
    }
  }

  /**
   * Cambia el estado de escena y re-renderiza al instante.
   * `context` queda reservado y se sigue ignorando por ahora.
   */
  function setScene(state, context = {}) {
    void context;
    sceneState = SCENE_STATES.includes(state) ? state : 'idle';
    const now = performance.now();
    const type = director.push(sceneState, now);
    if (type === 'celebrate') {
      if (!reducedMotion && !document.hidden) {
        confetti = createConfetti((now | 0) || 1);
        confettiStart = now;
      }
      playJingle(); // solo suena si el usuario activó el sonido (opt-in)
    }
    if (reducedMotion || document.hidden) director.skipToEnd();
    syncLoop();
    render();
  }

  let lastScale = 0;
  function resize() {
    if (!host) return;
    const fullView = host.classList.contains('full-view');
    // En la vista mixta ancha la franja de tarjetas va al costado: se le reserva su ancho.
    const sideBySide = !fullView && !!window.matchMedia?.(SIDE_BY_SIDE_QUERY).matches;
    const availableWidth = host.clientWidth - 24 - (sideBySide ? 280 : 0); // padding (+ franja)
    const availableHeight = window.innerHeight * (fullView ? 0.6 : 0.4);
    const scale = computeScale(availableWidth, availableHeight, window.devicePixelRatio);
    if (scale === lastScale) return; // evita bucles con ResizeObserver
    lastScale = scale;
    canvas.style.width = INTERNAL_WIDTH * scale + 'px';
    canvas.style.height = INTERNAL_HEIGHT * scale + 'px';
  }

  let destroyed = false;
  let rafId = 0;

  function shouldRun() {
    return !destroyed && !document.hidden && !reducedMotion;
  }

  function frame(now) {
    rafId = 0;
    if (!shouldRun()) return;
    render(now);
    rafId = requestAnimationFrame(frame);
  }

  /** Arranca o detiene el bucle rAF según visibilidad, reduced-motion y destroy. */
  function syncLoop() {
    if (shouldRun()) {
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function onVisibility() {
    if (document.hidden) {
      director.skipToEnd(); // al volver, la escena ya está en el estado final
      confettiStart = null;
      confetti = [];
    }
    syncLoop();
    if (!document.hidden) render();
  }

  function onMotionChange() {
    reducedMotion = !!motionQuery?.matches;
    if (reducedMotion) {
      director.skipToEnd();
      confettiStart = null;
      confetti = [];
    }
    syncLoop();
    render();
  }

  let observer = null;
  if (host && typeof globalThis.ResizeObserver === 'function') {
    observer = new ResizeObserver(resize);
    observer.observe(host);
  }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  motionQuery?.addEventListener?.('change', onMotionChange);

  resize();
  render();
  syncLoop();

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (observer) observer.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    motionQuery?.removeEventListener?.('change', onMotionChange);
    audioCtx?.close?.().catch?.(() => {});
    audioCtx = null;
  }

  return {
    render,
    resize,
    destroy,
    setScene,
    setSoundEnabled,
    isSoundEnabled,
    unlockAudio,
    playJingle,
    map,
  };
}
