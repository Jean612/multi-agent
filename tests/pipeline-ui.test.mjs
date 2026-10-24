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
