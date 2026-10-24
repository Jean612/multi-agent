/**
 * Tests de bin/pipeline-ui.mjs (Mission Control — Opción C).
 * 100% Node.js nativo; sin LLMs reales (runner inyectado / dry-run).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import {
  createMissionControlServer,
  getGitInfo,
  readPipelineFiles,
  discoverProjects,
} from '../bin/pipeline-ui.mjs';
import { runStep } from '../bin/pipeline-run.mjs';

const execFile = promisify(execFileCallback);
const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pipeline-ui.mjs');

/** Crea un proyecto temporal. */
async function makeProject(fixtures = {}) {
  const projectDir = await fs.mkdtemp(path.join(tmpdir(), 'pipeline-ui-test-'));
  if (Object.keys(fixtures).length > 0) {
    await fs.mkdir(path.join(projectDir, '.pipeline'), { recursive: true });
    for (const [name, content] of Object.entries(fixtures)) {
      await fs.writeFile(path.join(projectDir, '.pipeline', name), content, 'utf8');
    }
  }
  return projectDir;
}

async function cleanupTemp(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Levanta un Mission Control en puerto efímero y devuelve helpers de test. */
async function startServer(options = {}) {
  const controller = createMissionControlServer(options);
  const port = await controller.listen(0, '127.0.0.1');
  const fetchJson = async (pathname, init) => {
    const resp = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
    const type = resp.headers.get('content-type') ?? '';
    const body = type.includes('json') ? await resp.json() : await resp.text();
    return { status: resp.status, body };
  };
  return { controller, port, fetchJson };
}

/** Suscriptor SSE que resuelve cuando ve la marca inicial y acumula eventos hasta stop(). */
function startSSEListener(port, finalMarker = '"type":"run_end"') {
  const controller = new AbortController();
  let text = '';
  let resolveConnected;
  const connected = new Promise((resolve) => {
    resolveConnected = resolve;
    setTimeout(() => resolve('timeout'), 3000);
  });
  const finished = (async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('"type":"connected"')) resolveConnected(true);
        if (text.includes(finalMarker)) break;
      }
    } catch {}
    return text;
  })();
  return {
    connected,
    stop: async () => {
      // Espera a que el reader haya procesado el marcador final (evita abortar
      // antes de que llegue el último chunk con "run_end").
      const deadline = Date.now() + 2000;
      while (!text.includes(finalMarker) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      controller.abort();
      return await finished;
    },
  };
}

function parseEvents(raw) {
  return raw
    .split('\n\n')
    .filter((part) => part.startsWith('data: '))
    .map((part) => JSON.parse(part.slice('data: '.length)));
}

/** Petición HTTP cruda (permite falsificar el header Host). */
function rawRequest(port, { path: reqPath = '/api/state', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('GET / responde 200 OK con las 3 columnas de Mission Control', async () => {
  const { controller, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { status, body } = await fetchJson('/');
    assert.equal(status, 200);
    assert.match(body, /01-PLAN\.md/);
    assert.match(body, /02-HANDOFF\.md/);
    assert.match(body, /03-QA-REPORT\.md/);
    assert.match(body, /Multi-Agent Mission Control/);
    assert.match(body, /EventSource\('\/api\/events'\)/);
    assert.match(body, /qa-semaphore/);
    assert.match(body, /git-drawer/);
    // TASK-01: responsividad (3 columnas en desktop, apilado < 1100px / < 720px),
    // modo monitor limpio (banner, visor y controles plegados) y visor de roadmap.
    assert.match(body, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(body, /@media\s*\(max-width:\s*1100px\)/);
    assert.match(body, /@media\s*\(max-width:\s*720px\)/);
    assert.match(body, /grid-template-columns:\s*1fr/);
    assert.match(body, /id="live-banner"/);
    assert.match(body, /id="plan-viewer"/);
    assert.match(body, /id="manual-controls"/);
    assert.match(body, /\.column\.live/);
    assert.match(body, /id="roadmap-view"/);
    assert.match(body, /roadmap-card/);
    assert.match(body, /overflow-x:\s*hidden/);
  } finally {
    await controller.close();
  }
});

test('GET / incluye el escenario Pixel Agents, selector de vista y animaciones (TASK-02)', async () => {
  const { controller, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { status, body } = await fetchJson('/');
    assert.equal(status, 200);
    // Escenario y selector de vista.
    assert.match(body, /id="pixel-office"/);
    assert.match(body, /id="view-mode-select"/);
    assert.match(body, /Oficina Pixel \+ Columnas/);
    assert.match(body, /Solo Oficina Pixel/);
    assert.match(body, /Solo Columnas/);
    // Los 3 escritorios pixel-art.
    assert.match(body, /id="desk-planner"/);
    assert.match(body, /id="desk-coder"/);
    assert.match(body, /id="desk-qa"/);
    assert.match(body, /id="pixel-scene-badge"/);
    // Clases de estado (los keyframes DOM se retiraron en TASK-04).
    assert.match(body, /\.pixel-desk\.designing/);
    assert.match(body, /\.pixel-desk\.typing/);
    assert.match(body, /\.pixel-desk\.inspecting/);
    assert.match(body, /\.pixel-desk\.celebrating/);
    assert.match(body, /\.pixel-desk\.alert/);
    assert.doesNotMatch(body, /@keyframes pixel-/);
    assert.doesNotMatch(body, /\.pixel-avatar/);
    assert.doesNotMatch(body, /\.pixel-monitor/);
    assert.doesNotMatch(body, /\.screen-line/);
    // Lógica reactiva y selector de vista.
    assert.match(body, /function updatePixelOffice/);
    assert.match(body, /function applyViewMode/);
    // Responsividad conservada: la oficina colapsa a 1 columna en pantallas medianas.
    assert.match(body, /@media\s*\(max-width:\s*1100px\)/);
    assert.match(body, /\.office-floor\s*\{\s*grid-template-columns:\s*1fr/);
  } finally {
    await controller.close();
  }
});

test('GET /api/state en un proyecto vacío: planExists false y estructura completa', async () => {
  const projectDir = await makeProject();
  const { controller, fetchJson } = await startServer({ defaultProjectDir: projectDir });
  try {
    const { status, body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(status, 200);
    assert.equal(body.status.planExists, false);
    assert.deepEqual(Object.keys(body).sort(), [
      'activeRun', 'autoWatchPlan', 'bins', 'defaultProjectDir', 'files', 'git', 'projectDir', 'status',
    ].sort());
    assert.ok('plan' in body.files && 'handoff' in body.files && 'qaReport' in body.files);
    assert.equal(body.git.isRepo, false);
    assert.equal(body.git.branch, null);
    assert.equal(body.activeRun.running, false);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('POST /api/plan guarda 01-PLAN.md, y /api/state refleja planExists, task y contenido', async () => {
  const projectDir = await makeProject();
  const { controller, fetchJson } = await startServer({ defaultProjectDir: '/tmp/no-se-usa' });
  try {
    const content = '# Plan\n- **Tarea:** Mission Control E2E\n- **Estado:** READY_FOR_CODE\n';
    const saved = await fetchJson('/api/plan', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, content }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.status.planExists, true);
    assert.equal(saved.body.status.task, 'Mission Control E2E');

    const onDisk = await fs.readFile(path.join(projectDir, '.pipeline', '01-PLAN.md'), 'utf8');
    assert.equal(onDisk, content);

    const { body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(body.status.planExists, true);
    assert.equal(body.status.task, 'Mission Control E2E');
    assert.equal(body.files.plan, content);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('POST /api/run loop wait:true con runner inyectado: APPROVED + eventos SSE', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Runner inyectado\n',
  });
  const { controller, port, fetchJson } = await startServer({
    defaultProjectDir: projectDir,
    runner: async ({ step }) => {
      if (step === 'code') {
        await fs.writeFile(path.join(projectDir, '.pipeline', '02-HANDOFF.md'), '# Handoff\n- **Iteración:** 1\n');
      } else if (step === 'qa') {
        await fs.writeFile(path.join(projectDir, '.pipeline', '03-QA-REPORT.md'), '# QA\nSTATUS: APPROVED\n');
      }
      return { exitCode: 0 };
    },
  });
  try {
    const sse = startSSEListener(port);
    assert.equal(await sse.connected, true, 'SSE debe enviar "connected"');

    // wait: true → la respuesta HTTP llega cuando el bucle ya terminó.
    const { status, body } = await fetchJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'loop', wait: true, maxRetries: 3 }),
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.status, 'APPROVED');
    assert.deepEqual(body.result.steps, ['code', 'qa']);

    const rawEvents = await sse.stop();
    const events = parseEvents(rawEvents).map((e) => e.type);
    assert.ok(events.includes('connected'));
    assert.ok(events.includes('run_start'));
    assert.ok(events.includes('step_start'));
    assert.ok(events.includes('step_end'));
    assert.ok(events.includes('run_end'));

    const { body: state } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(state.status.qaStatus, 'APPROVED');
    assert.equal(state.files.qaReport.includes('STATUS: APPROVED'), true);
    assert.equal(state.activeRun.running, false);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('POST /api/run rechaza: action inválida → 400, y ejecución concurrente → 409', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Concurrency\n',
  });
  const { controller, fetchJson } = await startServer({
    defaultProjectDir: projectDir,
    runner: async () => {
      // Simula un paso lento para poder solapar una segunda petición.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { exitCode: 0 };
    },
  });
  try {
    const badAction = await fetchJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'deploy' }),
    });
    assert.equal(badAction.status, 400);

    // wait:false arranca sin bloquear y sigue corriendo; la segunda petición debe chocar con 409.
    const first = await fetchJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'loop' }),
    });
    assert.equal(first.status, 202);

    const second = await fetchJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'loop', wait: true }),
    });
    assert.equal(second.status, 409);
    assert.match(second.body.error, /ejecución en curso/i);

    // Espera a que termine la primera (polling del estado).
    for (let i = 0; i < 20; i++) {
      const { body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
      if (!body.activeRun.running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('dryRun en /api/run no invoca binarios reales y marca dryRun', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** DryRun\n',
  });
  const { controller, fetchJson } = await startServer({ defaultProjectDir: projectDir });
  try {
    const { body } = await fetchJson('/api/run', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'loop', dryRun: true, wait: true }),
    });
    assert.equal(body.ok, true);
    assert.ok(body.result.steps.length > 0);
    // El estado no cambió: no se escribieron archivos de agentes.
    const { body: state } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(state.status.handoffExists, false);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('helpers: getGitInfo tolera no-repos, readPipelineFiles y discoverProjects', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Helpers\n',
  });
  try {
    const git = await getGitInfo(projectDir);
    assert.equal(git.isRepo, false);
    assert.equal(git.branch, null);
    assert.equal(git.statusShort, '');
    assert.equal(git.diff, '');

    const files = await readPipelineFiles(projectDir);
    assert.match(files.plan, /Helpers/);
    assert.equal(files.handoff, null);
    assert.equal(files.roadmap, null);
    assert.equal(files.latestLog, null);

    const parent = path.dirname(projectDir);
    const projects = await discoverProjects(projectDir);
    const listed = new Set(projects.map((p) => p.name + '|' + p.path));
    assert.ok(
      [...listed].some((entry) => entry.endsWith(path.basename(projectDir))),
      'el proyecto activo (con .pipeline) debe aparecer en el descubrimiento'
    );
    // Descubrimiento sobre un directorio inexistente no lanza.
    const none = await discoverProjects('/tmp/no-existe-mission-control-xyz');
    assert.deepEqual(none, []);
  } finally {
    await cleanupTemp(projectDir);
  }
});

test('GET /api/state devuelve el contenido de ROADMAP.md cuando existe (TASK-01)', async () => {
  const roadmapContent = [
    '# Roadmap de Épica',
    '- **Estado General:** IN_PROGRESS',
    '',
    '### [ ] TASK-01: Responsividad',
    '- **Objetivo:** Adaptar la GUI',
    '- [ ] Criterio pendiente',
  ].join('\n');
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Roadmap state\n',
    'ROADMAP.md': roadmapContent,
  });
  const { controller, fetchJson } = await startServer({ defaultProjectDir: projectDir });
  try {
    const { status, body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(status, 200);
    assert.equal(body.files.roadmap, roadmapContent);
    assert.match(body.files.roadmap, /TASK-01/);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('GET /api/state refleja runtime.json de una corrida CLI externa (TASK-01)', async () => {
  const runtime = {
    running: true,
    action: 'loop',
    step: 'code',
    iteration: 2,
    qaEngine: 'kimi',
    updatedAt: '2026-10-24T05:00:00.000Z',
  };
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Runtime telemetry\n',
    'runtime.json': JSON.stringify(runtime, null, 2),
  });
  const { controller, fetchJson } = await startServer({ defaultProjectDir: projectDir });
  try {
    const { status, body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(status, 200);
    // La corrida externa se refleja en activeRun sin tocar la memoria del servidor.
    assert.equal(body.activeRun.running, true);
    assert.equal(body.activeRun.step, 'code');
    assert.equal(body.activeRun.iteration, 2);
    assert.equal(body.activeRun.action, 'loop');
    assert.equal(body.activeRun.projectDir, projectDir);
    assert.equal(body.files.runtime.step, 'code');
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('runtime.json inválido no rompe /api/state y activeRun sigue en reposo (TASK-01)', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Runtime inválido\n',
    'runtime.json': '{ esto no es json',
  });
  const { controller, fetchJson } = await startServer({ defaultProjectDir: projectDir });
  try {
    const { status, body } = await fetchJson(`/api/state?dir=${encodeURIComponent(projectDir)}`);
    assert.equal(status, 200);
    assert.equal(body.files.runtime, null);
    assert.equal(body.activeRun.running, false);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('runStep escribe runtime.json (running true durante el paso, false al terminar) y dryRun no escribe', async () => {
  const projectDir = await makeProject();
  const runtimePath = path.join(projectDir, '.pipeline', 'runtime.json');
  try {
    let during = null;
    await runStep('code', {
      projectDir,
      runner: async () => {
        during = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
        return { exitCode: 0 };
      },
    });
    assert.equal(during.running, true);
    assert.equal(during.step, 'code');
    assert.equal(during.iteration, 1);
    assert.ok(typeof during.updatedAt === 'string' && during.updatedAt.length > 0);
    const after = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
    assert.equal(after.running, false);
    assert.equal(after.step, 'code');

    // dryRun no debe ensuciar el proyecto con telemetría en disco.
    await fs.rm(runtimePath, { force: true });
    await runStep('qa', { projectDir, dryRun: true });
    await assert.rejects(fs.access(runtimePath));
  } finally {
    await cleanupTemp(projectDir);
  }
});

test('POST /api/run?wait=true por query espera y devuelve el resultado (sin body.wait)', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Wait por query\n',
  });
  const { controller, fetchJson } = await startServer({
    defaultProjectDir: projectDir,
    runner: async ({ step }) => {
      if (step === 'code') {
        await fs.writeFile(path.join(projectDir, '.pipeline', '02-HANDOFF.md'), '# Handoff\n- **Iteración:** 1\n');
      } else if (step === 'qa') {
        await fs.writeFile(path.join(projectDir, '.pipeline', '03-QA-REPORT.md'), '# QA\nSTATUS: APPROVED\n');
      }
      return { exitCode: 0 };
    },
  });
  try {
    const { status, body } = await fetchJson('/api/run?wait=true', {
      method: 'POST',
      body: JSON.stringify({ dir: projectDir, action: 'loop' }), // sin wait en el body
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.status, 'APPROVED');
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('rechaza peticiones con Host no permitido (403, mitigación DNS rebinding)', async () => {
  const projectDir = await makeProject();
  const { controller, port } = await startServer({ defaultProjectDir: projectDir });
  try {
    const evil = await rawRequest(port, {
      path: `/api/state?dir=${encodeURIComponent(projectDir)}`,
      headers: { Host: 'evil.example.com' },
    });
    assert.equal(evil.status, 403);
    assert.match(evil.body, /Host no permitido/);

    // Host loopback sigue funcionando.
    const ok = await rawRequest(port, {
      path: `/api/state?dir=${encodeURIComponent(projectDir)}`,
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(ok.status, 200);
  } finally {
    await controller.close();
    await cleanupTemp(projectDir);
  }
});

test('CLI bin/pipeline-ui.mjs --help vía symlink sale con código 0 y muestra uso', async () => {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'pipeline-ui-cli-'));
  try {
    const linkPath = path.join(tempDir, 'pipeline-ui-link');
    await fs.symlink(CLI_PATH, linkPath, 'file');
    const { stdout } = await execFile(process.execPath, [linkPath, '--help']);
    assert.match(stdout, /Uso: pipeline-ui/);
    assert.match(stdout, /--port/);
    assert.match(stdout, /api\/events/);
  } finally {
    await cleanupTemp(tempDir);
  }
});

test('GET /office.js sirve el módulo de la oficina canvas (Pixel Office v3 TASK-01)', async () => {
  const { controller, port } = await startServer({ defaultProjectDir: '.' });
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/office.js`);
    const body = await resp.text();
    assert.equal(resp.status, 200);
    assert.ok((resp.headers.get('content-type') ?? '').includes('text/javascript'));
    assert.match(body, /export function createOffice/);
    assert.match(body, /INTERNAL_WIDTH = 320/);
  } finally {
    await controller.close();
  }
});

test('GET / monta el canvas de la oficina y carga /office.js como módulo', async () => {
  const { controller, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { status, body } = await fetchJson('/');
    assert.equal(status, 200);
    assert.match(body, /id="office-canvas"/);
    assert.match(body, /<script type="module">/);
    assert.match(body, /from '\/office\.js'/);
    // Las tarjetas pixel-desk actuales siguen visibles (se reemplazan en TASK-02).
    assert.match(body, /id="desk-planner"/);
  } finally {
    await controller.close();
  }
});

test('GET / incluye el botón de sonido 8-bit apagado por defecto (Pixel Office v3 TASK-04)', async () => {
  const { controller, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { status, body } = await fetchJson('/');
    assert.equal(status, 200);
    assert.match(body, /id="office-sound-toggle"/);
    assert.match(body, /aria-pressed="false"/);
    assert.match(body, /try\s*\{\s*return localStorage\.getItem/);
    assert.match(body, /try\s*\{\s*localStorage\.setItem/);
    assert.match(body, /setSoundEnabled/);
    assert.match(body, /unlockAudio/);
  } finally {
    await controller.close();
  }
});

test('rutas estáticas fuera de la lista blanca responden 404 (sin path traversal)', async () => {
  const { controller, port } = await startServer({ defaultProjectDir: '.' });
  try {
    const forbidden = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/ui/office.js',
      '/office.js/../package.json',
      '/bin/pipeline-ui.mjs',
      '/package.json',
    ];
    for (const reqPath of forbidden) {
      const res = await rawRequest(port, {
        path: reqPath,
        headers: { Host: `127.0.0.1:${port}` },
      });
      assert.equal(res.status, 404, `${reqPath} debe responder 404`);
    }
  } finally {
    await controller.close();
  }
});

test('buildOfficeMap y computeScale son puros e importables en Node', async () => {
  const office = await import('../ui/office.js');

  const map = office.buildOfficeMap();
  assert.equal(map.cols, 20);
  assert.equal(map.rows, 12);
  assert.equal(map.tiles.length, 12);
  for (const row of map.tiles) assert.equal(row.length, 20);
  assert.equal(map.tiles[0][0], 'wall');
  assert.equal(map.tiles[2][0], 'floor');
  assert.deepEqual(map.desks.map((d) => d.id), ['planner', 'coder', 'qa']);

  const types = new Set(map.props.map((p) => p.type));
  for (const type of ['desk', 'chair', 'monitor', 'bookshelf', 'coffee', 'plant']) {
    assert.ok(types.has(type), `falta un prop de tipo ${type}`);
  }
  for (const prop of map.props) {
    assert.ok(prop.col >= 0 && prop.col + prop.w <= 20, `prop fuera de rango horizontal: ${JSON.stringify(prop)}`);
    assert.ok(prop.row >= 0 && prop.row + prop.h <= 12, `prop fuera de rango vertical: ${JSON.stringify(prop)}`);
  }

  assert.equal(office.computeScale(1000, 600), 3);
  assert.equal(office.computeScale(100, 100), 1);
  assert.equal(office.computeScale(640, 1000), 2);
  assert.equal(office.computeScale(NaN, 100), 1);
  assert.equal(office.computeScale(-5, 0), 1);
});

test('computeScale escala en pasos nítidos según devicePixelRatio y la vista mixta pone la franja al costado', async () => {
  const office = await import('../ui/office.js');
  // dpr 2: pasos de 0.5× CSS (cada píxel lógico = entero de píxeles físicos).
  assert.equal(office.computeScale(480, 270, 2), 1.5);
  assert.equal(office.computeScale(500, 300, 2), 1.5);
  assert.equal(office.computeScale(640, 360, 2), 2);
  assert.equal(office.computeScale(500, 300, 1), 1);
  assert.equal(office.computeScale(100, 100, 2), 1);
  // dpr inválido cae a 1.
  assert.equal(office.computeScale(1000, 600, NaN), 3);
  assert.equal(office.computeScale(1000, 600, 0), 3);

  const { controller, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { body } = await fetchJson('/');
    assert.match(body, /class="office-stage"/);
    // El breakpoint del CSS y el de office.js deben coincidir.
    assert.ok(body.includes(`@media ${office.SIDE_BY_SIDE_QUERY}`), 'breakpoint de la vista mixta desincronizado');
  } finally {
    await controller.close();
  }
});

test('poseFor cubre los 7 estados de escena con la tabla del plan (Pixel Office v3 TASK-02)', async () => {
  const office = await import('../ui/office.js');
  assert.deepEqual(office.SCENE_STATES, ['idle', 'planning', 'code', 'fix', 'qa', 'approved', 'changes_required']);

  const expected = {
    idle:             { planner: 'idle',   coder: 'idle',   qa: 'idle'    },
    planning:         { planner: 'typing', coder: 'idle',   qa: 'idle'    },
    code:             { planner: 'idle',   coder: 'typing', qa: 'idle'    },
    fix:              { planner: 'idle',   coder: 'typing', qa: 'idle'    },
    qa:               { planner: 'idle',   coder: 'idle',   qa: 'inspect' },
    approved:         { planner: 'jump',   coder: 'jump',   qa: 'jump'    },
    changes_required: { planner: 'idle',   coder: 'idle',   qa: 'alert'   },
  };
  for (const state of office.SCENE_STATES) {
    for (const id of office.DESK_IDS) {
      assert.equal(office.poseFor(state, id), expected[state][id], `poseFor(${state}, ${id})`);
    }
  }
  assert.equal(office.poseFor('desconocido', 'planner'), 'idle');
  assert.equal(office.poseFor('qa', 'fantasma'), 'idle');
});

test('buildAgentSprite genera sprites 16×24 válidos para todas las poses y frames', async () => {
  const office = await import('../ui/office.js');
  const validChars = new Set('.HSBDPKLG');

  for (const pose of Object.keys(office.POSES)) {
    const def = office.POSES[pose];
    for (let frame = 0; frame < def.frames; frame++) {
      const { rows, dy } = office.buildAgentSprite(pose, frame);
      assert.equal(rows.length, 24, `${pose}[${frame}] debe tener 24 filas`);
      for (const row of rows) {
        assert.equal(row.length, 16, `${pose}[${frame}] fila debe medir 16: "${row}"`);
        for (const ch of row) {
          assert.ok(validChars.has(ch), `${pose}[${frame}] carácter inválido: "${ch}"`);
        }
      }
      assert.equal(dy, def.dy[frame], `${pose}[${frame}] dy`);
    }
  }

  for (const id of office.DESK_IDS) {
    for (const ch of 'HSBDPKLG') {
      assert.ok(office.AGENT_PALETTES[id][ch], `AGENT_PALETTES.${id} debe definir "${ch}"`);
    }
  }

  const typing0 = office.buildAgentSprite('typing', 0);
  const typing1 = office.buildAgentSprite('typing', 1);
  assert.notDeepEqual(typing0.rows, typing1.rows, 'typing alterna manos entre frames');

  const inspectFrames = [0, 1, 2, 3].map((f) => office.buildAgentSprite('inspect', f));
  assert.ok(inspectFrames.some((s) => s.rows.some((r) => r.includes('G'))), 'inspect dibuja el vidrio de la lupa');

  assert.equal(office.buildAgentSprite('alert', 0).dx, -1);
  assert.equal(office.buildAgentSprite('alert', 1).dx, 1);

  assert.deepEqual([0, 1, 2, 3].map((f) => office.buildAgentSprite('jump', f).dy), [0, -3, -5, -3]);

  const idle = office.buildAgentSprite('idle', 0);
  const invalid = office.buildAgentSprite('no-existe', 0);
  assert.deepEqual(invalid, idle, 'una pose inválida devuelve lo mismo que idle');
});

test('frameIndexAt cicla frames y respeta reduced-motion', async () => {
  const office = await import('../ui/office.js');
  assert.equal(office.frameIndexAt('typing', 0), 0);
  assert.equal(office.frameIndexAt('typing', 120), 1);
  assert.equal(office.frameIndexAt('typing', 240), 0);
  assert.equal(office.frameIndexAt('jump', 360), 3);
  assert.equal(office.frameIndexAt('jump', 360, true), 0);
  assert.equal(office.frameIndexAt('nope', 500), 0);
  assert.equal(office.frameIndexAt('idle', NaN), 0);
  assert.deepEqual(office.agentAnchor({ col: 3, row: 5 }), { x: 56, y: 81 });
});

test('la UI conecta setScene, compacta las tarjetas y el módulo respeta reduced-motion/visibilidad', async () => {
  const { controller, port, fetchJson } = await startServer({ defaultProjectDir: '.' });
  try {
    const { status, body } = await fetchJson('/');
    assert.equal(status, 200);
    assert.match(body, /function applyPixelOfficeState/);
    assert.match(body, /function updatePixelOffice/);
    assert.match(body, /window\.pixelOffice\?\.setScene/);
    // La franja compacta conserva estados y globos de los 3 agentes.
    for (const id of ['desk-planner-state', 'desk-coder-state', 'desk-qa-state', 'bubble-planner', 'bubble-coder', 'bubble-qa']) {
      assert.ok(body.includes(`id="${id}"`), `falta id="${id}"`);
    }
    // Los muñecos viven en el canvas: ya no hay avatar ni monitor CSS.
    assert.ok(!body.includes('class="pixel-avatar'), 'no debe quedar pixel-avatar');
    assert.ok(!body.includes('class="pixel-monitor'), 'no debe quedar pixel-monitor');

    const resp = await fetch(`http://127.0.0.1:${port}/office.js`);
    const module = await resp.text();
    assert.match(module, /prefers-reduced-motion: reduce/);
    assert.match(module, /visibilitychange/);
    assert.match(module, /export function buildAgentSprite/);
  } finally {
    await controller.close();
  }
});
