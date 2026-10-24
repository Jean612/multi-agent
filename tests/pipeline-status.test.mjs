/**
 * Tests unitarios de bin/pipeline-status.mjs — 100% Node.js nativo.
 * Cubre los 5 estados del flujo Multi-Agente y limpia sus temporales.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzePipeline } from '../bin/pipeline-status.mjs';

/** Ruta absoluta del CLI dentro del repositorio (para el test de symlink). */
const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pipeline-status.mjs');

/** execFile con interfaz de promesas. */
const execFile = promisify(execFileCallback);

/** Crea un directorio temporal único para cada test. */
async function makeTempDir() {
  return fs.mkdtemp(path.join(tmpdir(), 'pipeline-status-test-'));
}

/** Crea dentro del tempDir la carpeta .pipeline/ con los archivos indicados. */
async function scaffold(fixtures) {
  const tempDir = await makeTempDir();
  const pipelineDir = path.join(tempDir, '.pipeline');
  if (Object.keys(fixtures).length > 0) {
    await fs.mkdir(pipelineDir, { recursive: true });
  }
  for (const [name, content] of Object.entries(fixtures)) {
    await fs.writeFile(path.join(pipelineDir, name), content, 'utf8');
  }
  return tempDir;
}

/** Limpia el directorio temporal del test. */
async function cleanup(tempDir) {
  await fs.rm(tempDir, { recursive: true, force: true });
}

test('estado 1: sin carpeta .pipeline/ sugiere generar el plan (Antigravity)', async () => {
  const tempDir = await scaffold({});
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.planExists, false);
    assert.equal(state.handoffExists, false);
    assert.equal(state.qaExists, false);
    assert.equal(state.task, null);
    assert.equal(state.iteration, null);
    assert.equal(state.qaStatus, null);
    assert.equal(state.nextStep, '1. Antigravity (Argon): Generar plan con pipeline-plan');
  } finally {
    await cleanup(tempDir);
  }
});

test('estado 2: solo 01-PLAN.md extrae la Tarea y sugiere /code (OpenCode)', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '# Plan\n- **Tarea:** Implementar CLI de estado\n- **Fecha:** 2026-10-23\n',
  });
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.planExists, true);
    assert.equal(state.task, 'Implementar CLI de estado');
    assert.equal(state.handoffExists, false);
    assert.equal(state.nextStep, '2. OpenCode Desktop: Ejecutar /code');
  } finally {
    await cleanup(tempDir);
  }
});

test('estado 3: 01-PLAN.md + 02-HANDOFF.md extraen Iteración y sugieren /qa (Kimi)', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '# Plan\n- **Tarea:** Implementar CLI de estado\n',
    '02-HANDOFF.md': '# Handoff\n- **Iteración:** 1\n- **Estado de Compilación / Tests:** PASS\n',
  });
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.planExists, true);
    assert.equal(state.handoffExists, true);
    assert.equal(state.iteration, '1');
    assert.equal(state.qaExists, false);
    assert.equal(state.nextStep, '3. Kimi Code Desktop: Ejecutar /qa');
  } finally {
    await cleanup(tempDir);
  }
});

test('estado 4: QA con CHANGES_REQUIRED y handoff sin tocar sugiere /fix (OpenCode)', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '# Plan\n- **Tarea:** Implementar CLI de estado\n',
    '02-HANDOFF.md': '# Handoff\n- **Iteración:** 1\n',
    '03-QA-REPORT.md': '# QA Report\nSTATUS: CHANGES_REQUIRED\n',
  });
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.qaExists, true);
    assert.equal(state.qaStatus, 'CHANGES_REQUIRED');
    assert.equal(
      state.nextStep,
      '2. OpenCode Desktop: Ejecutar /fix para corregir observaciones de QA'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('estado 4b (caso borde): QA CHANGES_REQUIRED pero handoff modificado después sugiere re-auditar /qa', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '# Plan\n- **Tarea:** Implementar CLI de estado\n',
    '02-HANDOFF.md': '# Handoff\n- **Iteración:** 2\n',
    '03-QA-REPORT.md': '# QA Report\nSTATUS: CHANGES_REQUIRED\n',
  });
  try {
    // El coder ya corrigió: 02-HANDOFF.md debe tener mtime > que 03-QA-REPORT.md.
    // Nota: en este volumen fs.utimes solo es fiable con objetos Date (no con números).
    const qaPath = path.join(tempDir, '.pipeline', '03-QA-REPORT.md');
    const handoffPath = path.join(tempDir, '.pipeline', '02-HANDOFF.md');
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(qaPath, past, past);
    await fs.utimes(handoffPath, new Date(), new Date());

    const state = await analyzePipeline(tempDir);
    assert.equal(state.qaStatus, 'CHANGES_REQUIRED');
    assert.ok(state.handoffMtime > state.qaMtime, 'handoff debe ser más reciente que QA');
    assert.equal(
      state.nextStep,
      '3. Kimi Code Desktop: Re-ejecutar /qa sobre las correcciones'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('estado 5: QA con STATUS: APPROVED sugiere pipeline-close (Antigravity)', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '# Plan\n- **Tarea:** Implementar CLI de estado\n',
    '02-HANDOFF.md': '# Handoff\n- **Iteración:** 1\n',
    '03-QA-REPORT.md': '- **STATUS:** APPROVED\n',
  });
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.qaStatus, 'APPROVED');
    assert.equal(state.nextStep, '4. Antigravity (Argon): Ejecutar pipeline-close');
  } finally {
    await cleanup(tempDir);
  }
});

test('no lanza excepciones ante archivos con contenido vacío o STATUS desconocido', async () => {
  const tempDir = await scaffold({
    '01-PLAN.md': '',
    '02-HANDOFF.md': 'sin campos',
    '03-QA-REPORT.md': 'algo raro sin STATUS',
  });
  try {
    const state = await analyzePipeline(tempDir);
    assert.equal(state.task, null);
    assert.equal(state.iteration, null);
    assert.equal(state.qaStatus, null);
    assert.equal(
      state.nextStep,
      '3. Kimi Code Desktop: Ejecutar /qa (STATUS no reconocido en 03-QA-REPORT.md)'
    );
  } finally {
    await cleanup(tempDir);
  }
});

test('caso borde QA fix: invocación del CLI vía symlink imprime la salida correctamente', async () => {
  const tempDir = await makeTempDir();
  try {
    // Simula ~/.local/bin/pipeline-status -> bin/pipeline-status.mjs del repositorio.
    const symlinkPath = path.join(tempDir, 'pipeline-status-link');
    try {
      await fs.symlink(CLI_PATH, symlinkPath, 'file');
    } catch (error) {
      if (error.code === 'EOPNOTSUPP' || error.code === 'EPERM') {
        // Entorno sin soporte de symlinks: el replicar la condición no es posible.
        return;
      }
      throw error;
    }

    const { stdout, stderr } = await execFile(process.execPath, [symlinkPath], {
      cwd: tempDir,
    });
    assert.equal(stderr, '');
    assert.match(stdout, /Pipeline Multi-Agente — estado de .pipeline\//);
    assert.match(stdout, /Siguiente paso:/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('caso borde: continuación del flujo — symlinks anidados 2 niveles igualmente ejecutan el CLI', async () => {
  const tempDir = await makeTempDir();
  try {
    // link1 -> CLI real ; link2 -> link1 (doble indirección).
    const link1 = path.join(tempDir, 'link1');
    const link2 = path.join(tempDir, 'link2');
    await fs.symlink(CLI_PATH, link1, 'file');
    await fs.symlink(link1, link2, 'file');

    const { stdout } = await execFile(process.execPath, [link2], { cwd: tempDir });
    assert.match(stdout, /Siguiente paso:/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
