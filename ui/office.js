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

/**
 * Calcula el factor de escala entero (múltiplos de píxel nítidos).
 * @param {number} availableWidth Ancho disponible en px CSS.
 * @param {number} availableHeight Alto disponible en px CSS.
 * @returns {number} Entero >= 1; 1 si los argumentos no son números finitos > 0.
 */
export function computeScale(availableWidth, availableHeight) {
  if (
    !Number.isFinite(availableWidth) || !Number.isFinite(availableHeight) ||
    availableWidth <= 0 || availableHeight <= 0
  ) {
    return 1;
  }
  return Math.max(
    1,
    Math.floor(Math.min(availableWidth / INTERNAL_WIDTH, availableHeight / INTERNAL_HEIGHT))
  );
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

/**
 * Monta la oficina pixel-art sobre un <canvas> existente.
 * @param {HTMLCanvasElement} canvas Canvas destino.
 * @param {{host?: HTMLElement}} [options] `host` opcional para medir el espacio disponible.
 * @returns {{render: Function, resize: Function, destroy: Function, map: object}|null}
 *   `null` si el canvas no ofrece contexto 2D (sin lanzar excepciones).
 */
export function createOffice(canvas, options = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;

  canvas.width = INTERNAL_WIDTH;
  canvas.height = INTERNAL_HEIGHT;
  ctx.imageSmoothingEnabled = false;

  const map = buildOfficeMap();

  // Capa estática prerenderizada una sola vez: el bucle solo hace drawImage.
  const staticLayer = document.createElement('canvas');
  staticLayer.width = INTERNAL_WIDTH;
  staticLayer.height = INTERNAL_HEIGHT;
  const staticCtx = staticLayer.getContext('2d');
  staticCtx.imageSmoothingEnabled = false;
  renderStaticScene(staticCtx, map);

  function render() {
    ctx.drawImage(staticLayer, 0, 0);
  }

  const host = options.host ?? canvas.closest('.pixel-office') ?? canvas.parentElement;
  let lastScale = 0;
  function resize() {
    if (!host) return;
    const availableWidth = host.clientWidth - 24; // padding del contenedor
    const availableHeight = host.classList.contains('full-view')
      ? window.innerHeight * 0.6
      : window.innerHeight * 0.35;
    const scale = computeScale(availableWidth, availableHeight);
    if (scale === lastScale) return; // evita bucles con ResizeObserver
    lastScale = scale;
    canvas.style.width = INTERNAL_WIDTH * scale + 'px';
    canvas.style.height = INTERNAL_HEIGHT * scale + 'px';
  }

  let destroyed = false;
  let rafId = 0;
  function frame() {
    if (destroyed) return;
    if (!document.hidden) render();
    rafId = requestAnimationFrame(frame);
  }

  let observer = null;
  if (host && typeof globalThis.ResizeObserver === 'function') {
    observer = new ResizeObserver(resize);
    observer.observe(host);
  }
  window.addEventListener('resize', resize);

  resize();
  render();
  rafId = requestAnimationFrame(frame);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(rafId);
    if (observer) observer.disconnect();
    window.removeEventListener('resize', resize);
  }

  return { render, resize, destroy, map };
}
