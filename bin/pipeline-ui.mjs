#!/usr/bin/env node
/**
 * pipeline-ui.mjs — "Mission Control" (Opción C): servidor HTTP local con SSE,
 * monitor Git, file watcher de .pipeline/ y ejecución orquestada del pipeline.
 * 100% Node.js nativo (ESM), cero dependencias externas.
 *
 * Uso: pipeline-ui [dir] [--port <N>] [--host <host>] [--open] [--help]
 */
import http from 'node:http';
import { promises as fs, realpathSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { analyzePipeline } from './pipeline-status.mjs';
import { runStep, runPipelineLoop, resolveBins } from './pipeline-run.mjs';

const VALID_ACTIONS = new Set(['code', 'fix', 'qa', 'loop']);
const WATCHED_FILES = new Set(['01-PLAN.md', '02-HANDOFF.md', '03-QA-REPORT.md', 'ROADMAP.md', 'runtime.json']);
const LATEST_LOG_MAX_LINES = 200;

/** Ruta absoluta de ui/index.html dentro del repositorio. */
const UI_HTML_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'ui',
  'index.html'
);

// ==============================================================================
// Helpers de infraestructura (Git, archivos, descubrimiento de proyectos)
// ==============================================================================

/**
 * Ejecuta `git arg...` en el proyecto con timeout seguro. Devuelve { err, stdout }.
 * @param {string} projectDir Ruta del proyecto.
 * @param {string[]} args Argumentos de git.
 * @returns {Promise<{err: Error|null, stdout: string}>}
 */
function runGit(projectDir, args) {
  return new Promise((resolve) => {
    try {
      execFile(
        'git',
        args,
        { cwd: projectDir, timeout: 5000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout) => resolve({ err, stdout: typeof stdout === 'string' ? stdout : '' })
      );
    } catch (error) {
      resolve({ err: error, stdout: '' });
    }
  });
}

/**
 * Lee el estado de Git del proyecto. Si no es un repo, no lanza: devuelve nulos/vacíos.
 * @param {string} projectDir Ruta del proyecto.
 * @returns {Promise<{branch: string|null, statusShort: string, diff: string, isRepo: boolean}>}
 */
export async function getGitInfo(projectDir) {
  const [status, diff, branch] = await Promise.all([
    runGit(projectDir, ['status', '--short']),
    runGit(projectDir, ['diff']),
    runGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  const isRepo = !status.err && !branch.err;
  return {
    branch: branch.err ? null : branch.stdout.trim(),
    statusShort: status.err ? '' : status.stdout,
    diff: diff.err ? '' : diff.stdout,
    isRepo,
  };
}

/**
 * Lectura segura de archivo de texto; null si no existe o no se puede leer.
 * @param {string} filePath Ruta del archivo.
 * @returns {Promise<string|null>}
 */
async function safeReadText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Devuelve las últimas ~200 líneas del log más reciente en .pipeline/logs/.
 * @param {string} pipelineDir Carpeta .pipeline del proyecto.
 * @returns {Promise<string|null>}
 */
async function readLatestLog(pipelineDir) {
  try {
    const entries = await fs.readdir(path.join(pipelineDir, 'logs'));
    const logs = entries.filter((name) => name.endsWith('.log')).sort();
    if (logs.length === 0) return null;
    const content = await safeReadText(path.join(pipelineDir, 'logs', logs[logs.length - 1]));
    if (content === null) return null;
    const lines = content.split('\n');
    return lines.length > LATEST_LOG_MAX_LINES
      ? lines.slice(-LATEST_LOG_MAX_LINES).join('\n')
      : content;
  } catch {
    return null;
  }
}

/**
 * Lee de forma segura los archivos del pipeline y el último log.
 * @param {string} projectDir Ruta del proyecto.
 * @returns {Promise<{plan: string|null, handoff: string|null, qaReport: string|null, roadmap: string|null, latestLog: string|null, runtime: object|null}>}
 */
export async function readPipelineFiles(projectDir) {
  const pipelineDir = path.join(projectDir, '.pipeline');
  const [plan, handoff, qaReport, roadmap, latestLog, runtimeRaw] = await Promise.all([
    safeReadText(path.join(pipelineDir, '01-PLAN.md')),
    safeReadText(path.join(pipelineDir, '02-HANDOFF.md')),
    safeReadText(path.join(pipelineDir, '03-QA-REPORT.md')),
    safeReadText(path.join(pipelineDir, 'ROADMAP.md')),
    readLatestLog(pipelineDir),
    safeReadText(path.join(pipelineDir, 'runtime.json')),
  ]);
  let runtime = null;
  if (runtimeRaw) {
    try {
      const parsed = JSON.parse(runtimeRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) runtime = parsed;
    } catch {
      // runtime.json puede estar a medio escribir: se ignora hasta el próximo evento.
      runtime = null;
    }
  }
  return { plan, handoff, qaReport, roadmap, latestLog, runtime };
}

/**
 * Descubre proyectos locales: subdirectorios de primer nivel del padre de baseDir
 * (y baseDir mismo) que contengan `.git` o `.pipeline`.
 * @param {string} baseDir Directorio base del proyecto activo.
 * @returns {Promise<Array<{name: string, path: string, hasPipeline: boolean}>>}
 */
export async function discoverProjects(baseDir) {
  const seen = new Set();
  const results = [];
  const possibleRoots = [path.dirname(baseDir), baseDir];
  for (const root of possibleRoots) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(root, entry.name);
      if (seen.has(projectPath)) continue;
      seen.add(projectPath);
      let hasGit = false;
      let hasPipeline = false;
      try {
        await fs.access(path.join(projectPath, '.git'));
        hasGit = true;
      } catch {}
      try {
        await fs.access(path.join(projectPath, '.pipeline'));
        hasPipeline = true;
      } catch {}
      if (hasGit || hasPipeline) {
        results.push({ name: path.basename(projectPath), path: projectPath, hasPipeline });
      }
    }
  }
  return results;
}

/**
 * Parsea el body JSON del request con límite de tamaño. Rechaza bodies inválidos.
 * @param {http.IncomingMessage} req Request.
 * @param {number} maxBytes Límite de tamaño (1 MB por defecto).
 * @returns {Promise<object|null>} Objeto parseado o null.
 */
function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// ==============================================================================
// Servidor Mission Control
// ==============================================================================

/**
 * Crea el servidor HTTP + SSE + watcher de "Mission Control".
 * @param {{defaultProjectDir?: string, runner?: Function, qaEngine?: 'kimi'|'opencode', qaModel?: string}} options
 * @returns {{server: http.Server, broadcast: Function, getSettings: Function, getState: Function, listen: Function, close: Function}}
 */
export function createMissionControlServer(options = {}) {
  const settings = {
    defaultProjectDir: options.defaultProjectDir || process.cwd(),
    qaEngine: options.qaEngine || 'kimi',
    qaModel: options.qaModel || null,
    autoWatchPlan: false,
  };
  const injectedRunner = options.runner;

  const sseClients = new Set();
  let activeRun = { running: false, action: null, projectDir: null, startedAt: null, iteration: 0, step: null };
  let watcher = null;
  let watcherProjectDir = null;
  let closed = false;
  let listenHost = '127.0.0.1';
  const debounceTimers = new Map();

  /**
   * Valida el header Host para mitigar DNS rebinding en un servidor local que
   * ejecuta agentes con coste. Solo acepta loopback y el host configurado.
   * @param {http.IncomingMessage} req Request HTTP.
   * @returns {boolean}
   */
  function isAllowedHost(req) {
    const host = (req.headers.host || '').toLowerCase();
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : null;
    if (!host || !port) return false;
    const allowed = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
      `::1:${port}`,
    ]);
    if (listenHost && listenHost !== '0.0.0.0' && listenHost !== '::') {
      const formatted = listenHost.includes(':') ? `[${listenHost}]` : listenHost;
      allowed.add(`${formatted}:${port}`);
    }
    return allowed.has(host);
  }

  /**
   * Envía un evento ObjJS a todos los clientes SSE.
   * @param {object} eventObj Evento serializable.
   */
  function broadcast(eventObj) {
    const payload = `data: ${JSON.stringify(eventObj)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function setWatcher(projectDir) {
    if (watcher && watcherProjectDir === projectDir) return;
    teardownWatcher();
    const pipelineDir = path.join(projectDir, '.pipeline');
    try {
      const newWatcher = watch(pipelineDir, { persistent: false }, (eventType, filename) => {
        if (closed || !filename) return;
        if (!WATCHED_FILES.has(filename)) return;
        // Debounce por archivo: los editores disparan múltiples eventos por guardado.
        const existing = debounceTimers.get(filename);
        if (existing) clearTimeout(existing);
        debounceTimers.set(
          filename,
          setTimeout(async () => {
            debounceTimers.delete(filename);
            if (closed) return;
            broadcast({ type: 'pipeline_file_changed', file: filename, projectDir });
            if (filename === '01-PLAN.md' && settings.autoWatchPlan && !activeRun.running) {
              await maybeAutoTrigger(projectDir);
            }
          }, 150)
        );
      });
      // fs.watch puede emitir 'error' de forma asíncrona (p. ej. si .pipeline/
      // se elimina con el watcher activo). Sin listener, el proceso Node cae.
      newWatcher.on('error', () => {
        if (watcher === newWatcher) teardownWatcher();
      });
      watcher = newWatcher;
      watcherProjectDir = projectDir;
    } catch {
      // La carpeta .pipeline aún no existe: se reintentará en próximas interacciones.
      watcher = null;
      watcherProjectDir = null;
    }
  }

  function teardownWatcher() {
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
    watcherProjectDir = null;
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
  }

  /**
   * Auto-Trigger: si el plan está READY_FOR_CODE, sin handoff y sin corrida activa,
   * lanza el loop del pipeline automáticamente.
   * @param {string} projectDir Ruta del proyecto.
   */
  async function maybeAutoTrigger(projectDir) {
    try {
      const state = await analyzePipeline(projectDir);
      const planContent = await safeReadText(
        path.join(projectDir, '.pipeline', '01-PLAN.md')
      );
      const ready = planContent && /READY_FOR_CODE/.test(planContent);
      // Revalidación tras los await: dos timers de debounce distintos pueden
      // interleavarse aquí y lanzar dos loops concurrentes (doble cuota LLM).
      if (activeRun.running) return;
      if (state.planExists && !state.handoffExists && ready) {
        broadcast({ type: 'auto_trigger', projectDir });
        triggerRun({ dir: projectDir, action: 'loop', maxRetries: 3 }).catch(() => {});
      }
    } catch {
      // Nunca propagar errores del watcher.
    }
  }

  /**
   * Estado completo del proyecto para /api/state.
   * @param {string} projectDir Ruta del proyecto (por defecto el configurado).
   */
  async function getState(projectDir = settings.defaultProjectDir) {
    setWatcher(projectDir);
    const [status, files, git] = await Promise.all([
      analyzePipeline(projectDir),
      readPipelineFiles(projectDir),
      getGitInfo(projectDir),
    ]);
    // Telemetría pasiva: si el loop corre en otro proceso (CLI/Antigravity), la
    // memoria de este servidor dice `running: false` pero runtime.json manda.
    let effectiveActiveRun = { ...activeRun };
    if (!activeRun.running && files.runtime && files.runtime.running === true) {
      effectiveActiveRun = {
        running: true,
        action: files.runtime.action || 'loop',
        projectDir,
        startedAt: files.runtime.updatedAt ?? null,
        iteration: files.runtime.iteration ?? 1,
        step: files.runtime.step ?? null,
        source: 'runtime.json',
      };
    }
    return {
      defaultProjectDir: settings.defaultProjectDir,
      projectDir,
      status,
      files,
      git,
      activeRun: effectiveActiveRun,
      autoWatchPlan: settings.autoWatchPlan,
      bins: resolveBins({ qaEngine: settings.qaEngine, qaModel: settings.qaModel }),
    };
  }

  /**
   * Ejecuta una acción del pipeline (code/fix/qa/loop) con eventos SSE.
   * @param {{dir?: string, action: string, maxRetries?: number, qaEngine?: string, qaModel?: string, dryRun?: boolean}} bodyParams
   */
  async function triggerRun(bodyParams) {
    // Defensa en profundidad: una segunda invocación concurrente (p. ej. Auto-Trigger
    // solapado) no debe arrancar otro loop de LLMs.
    if (activeRun.running) {
      return { status: 'BUSY', reason: 'Ya hay una ejecución en curso' };
    }
    const projectDir = path.resolve(bodyParams.dir || settings.defaultProjectDir);
    activeRun = {
      running: true,
      action: bodyParams.action,
      projectDir,
      startedAt: new Date().toISOString(),
      iteration: 0,
      step: null,
    };
    broadcast({ type: 'run_start', action: bodyParams.action, projectDir });

    const onEvent = (event) => {
      if (event.type === 'step_start') {
        activeRun.step = event.step;
        activeRun.iteration = event.iteration;
      }
      broadcast(event);
    };

    let result;
    try {
      if (bodyParams.action === 'loop') {
        result = await runPipelineLoop({
          projectDir,
          maxRetries: bodyParams.maxRetries ?? 3,
          runner: injectedRunner,
          dryRun: bodyParams.dryRun === true,
          qaEngine: bodyParams.qaEngine ?? settings.qaEngine,
          qaModel: bodyParams.qaModel ?? settings.qaModel,
          onEvent,
        });
      } else {
        result = await runStep(bodyParams.action, {
          projectDir,
          runner: injectedRunner,
          dryRun: bodyParams.dryRun === true,
          qaEngine: bodyParams.qaEngine ?? settings.qaEngine,
          qaModel: bodyParams.qaModel ?? settings.qaModel,
        });
        result = {
          status: `STEP_${bodyParams.action.toUpperCase()}_DONE`,
          iterations: 1,
          steps: [bodyParams.action],
          stepResult: result,
          finalState: await analyzePipeline(projectDir),
        };
      }
    } catch (error) {
      result = { status: 'ERROR', error: String(error?.message || error) };
    }

    activeRun = { running: false, action: null, projectDir: null, startedAt: null, iteration: 0, step: null };
    broadcast({ type: 'run_end', status: result.status, projectDir });
    return result;
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Mitigación DNS rebinding: solo hosts loopback/configurados.
      if (!isAllowedHost(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Host no permitido' }));
        return;
      }
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // SSE en /api/events: canal en tiempo real.
      if (method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: {"type":"connected"}\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // Archivo HTML de la UI.
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = await fs.readFile(UI_HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Descubrimiento de proyectos.
      if (method === 'GET' && pathname === '/api/projects') {
        const baseDir = path.resolve(url.searchParams.get('root') || settings.defaultProjectDir);
        const projects = await discoverProjects(baseDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ defaultProjectDir: settings.defaultProjectDir, projects }));
        return;
      }

      // Estado completo del proyecto (pipeline + archivos + git).
      if (method === 'GET' && pathname === '/api/state') {
        const dirParam = url.searchParams.get('dir');
        const projectDir = path.resolve(dirParam || settings.defaultProjectDir);
        const state = await getState(projectDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(state));
        return;
      }

      if (method === 'POST' && pathname === '/api/plan') {
        const body = await readJsonBody(req);
        if (!body || typeof body.content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Se requiere JSON { dir?, content, target? }' }));
          return;
        }
        const target = body.target === 'ROADMAP.md' ? 'ROADMAP.md' : '01-PLAN.md';
        const projectDir = path.resolve(body.dir || settings.defaultProjectDir);
        const pipelineDir = path.join(projectDir, '.pipeline');
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.writeFile(path.join(pipelineDir, target), body.content, 'utf8');
        broadcast({ type: 'plan_saved', file: target, projectDir });
        const status = await analyzePipeline(projectDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, target, status }));
        return;
      }

      if (method === 'POST' && pathname === '/api/settings') {
        const body = await readJsonBody(req);
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
          return;
        }
        if (typeof body.autoWatchPlan === 'boolean') settings.autoWatchPlan = body.autoWatchPlan;
        if (typeof body.defaultProjectDir === 'string' && body.defaultProjectDir) {
          settings.defaultProjectDir = path.resolve(body.defaultProjectDir);
        }
        if (body.qaEngine === 'kimi' || body.qaEngine === 'opencode') settings.qaEngine = body.qaEngine;
        if (typeof body.qaModel === 'string') settings.qaModel = body.qaModel || null;
        broadcast({
          type: 'settings_updated',
          autoWatchPlan: settings.autoWatchPlan,
          defaultProjectDir: settings.defaultProjectDir,
          qaEngine: settings.qaEngine,
          qaModel: settings.qaModel,
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            autoWatchPlan: settings.autoWatchPlan,
            defaultProjectDir: settings.defaultProjectDir,
            qaEngine: settings.qaEngine,
            qaModel: settings.qaModel,
          })
        );
        return;
      }

      if (method === 'POST' && pathname === '/api/run') {
        const body = await readJsonBody(req);
        if (!body || !VALID_ACTIONS.has(body.action)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: "action debe ser 'code' | 'fix' | 'qa' | 'loop'" }));
          return;
        }
        if (activeRun.running) {
          res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Ya hay una ejecución en curso' }));
          return;
        }
        const wait = body.wait === true || url.searchParams.get('wait') === 'true';
        if (!wait) {
          res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, started: true, action: body.action }));
          await triggerRun(body);
          return;
        }
        const result = await triggerRun(body);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, result }));
        return;
      }

      // Resto de rutas: 404.
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  });

  /**
   * Escucha en host:puerto. Resuelve con el puerto efectivo (útil con puerto 0).
   * @param {number} port Puerto (0 = efímero).
   * @param {string} host Host.
   * @returns {Promise<number>} Puerto real de escucha.
   */
  function listen(port = 4173, host = '127.0.0.1') {
    listenHost = host;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        resolve(typeof address === 'object' ? address.port : port);
      });
    });
  }

  /** Cierra el servidor, el watcher y los clientes SSE. */
  function close() {
    closed = true;
    teardownWatcher();
    for (const client of sseClients) {
      try {
        client.end();
      } catch {}
    }
    sseClients.clear();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  return { server, broadcast, getSettings: () => ({ ...settings }), getState, listen, close };
}

// ==============================================================================
// CLI
// ==============================================================================

function printHelp() {
  console.log(`Uso: pipeline-ui [dir] [--port <N>] [--host <host>] [--open] [--help]

Mission Control: GUI local para orquestar el Pipeline Multi-Agente.

Argumentos:
  dir                  Directorio del proyecto (por defecto: cwd)

Opciones:
  --port <N>           Puerto del servidor (por defecto: 4173 o env PORT)
  --host <host>        Host de escucha (por defecto: 127.0.0.1)
  --open               Abre el navegador automáticamente
  --help               Muestra esta ayuda

API: GET /api/state · GET /api/projects · GET /api/events (SSE)
     POST /api/plan · POST /api/settings · POST /api/run`);
}

/**
 * Detiene si el módulo se ejecuta como CLI, también vía symlink global
 * (realpathSync sobre argv[1] resuelve la ruta real del archivo).
 * @returns {boolean}
 */
function isMainEntry() {
  if (!process.argv[1]) return false;
  let resolved;
  try {
    resolved = realpathSync(process.argv[1]);
  } catch {
    resolved = path.resolve(process.argv[1]);
  }
  return resolved === fileURLToPath(import.meta.url);
}

async function main(argv = process.argv.slice(2)) {
  const parseValue = (flag, next) => (next === undefined ? undefined : next);
  let projectDirArg = null;
  let port = Number(process.env.PORT) || 4173;
  let host = '127.0.0.1';
  let open = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exitCode = 0;
      return;
    }
    if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg.includes('=') ? arg.split('=')[1] : parseValue(arg, argv[++i]);
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
      continue;
    }
    if (arg === '--host' || arg.startsWith('--host=')) {
      const value = arg.includes('=') ? arg.split('=')[1] : parseValue(arg, argv[++i]);
      if (value) host = value;
      continue;
    }
    if (arg === '--open') {
      open = true;
      continue;
    }
    if (arg === '--json') continue; // Compatibilidad (no cambia la salida)
    if (!arg.startsWith('--')) projectDirArg = arg;
  }

  const missionControl = createMissionControlServer({
    defaultProjectDir: path.resolve(projectDirArg || process.cwd()),
  });
  const actualPort = await missionControl.listen(port, host);
  console.log('🛰️  Multi-Agent Mission Control');
  console.log(`   URL:      http://${host}:${actualPort}`);
  console.log(`   Proyecto: ${path.resolve(projectDirArg || process.cwd())}`);
  console.log('   (Ctrl+C para detener)');

  if (open) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(opener, [`http://${host}:${actualPort}`], () => {});
  }

  const shutdown = async () => {
    await missionControl.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isMainEntry()) {
  await main();
}
