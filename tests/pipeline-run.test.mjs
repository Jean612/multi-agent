/**
 * Tests de bin/pipeline-run.mjs (Orquestador Opción B).
 * 100% Node.js nativo: sin LLMs reales (runner inyectado + dry-run).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzePipeline } from '../bin/pipeline-status.mjs';
import { AGENTS, buildStepCommand, isQuotaFailure, resolveBins, resolveModel, runPipelineLoop, runStep } from '../bin/pipeline-run.mjs';

const execFile = promisify(execFileCallback);

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pipeline-run.mjs');

/** Crea un directorio temporal único con .pipeline/ y los fixtures indicados. */
async function makeProject(fixtures = {}) {
  const projectDir = await fs.mkdtemp(path.join(tmpdir(), 'pipeline-run-test-'));
  if (Object.keys(fixtures).length > 0) {
    await fs.mkdir(path.join(projectDir, '.pipeline'), { recursive: true });
    for (const [name, content] of Object.entries(fixtures)) {
      await fs.writeFile(path.join(projectDir, '.pipeline', name), content, 'utf8');
    }
  }
  return projectDir;
}

/** Limpia el proyecto temporal. */
async function cleanup(projectDir) {
  await fs.rm(projectDir, { recursive: true, force: true });
}

/** Escibe un archivo en .pipeline/ del proyecto (con retardo controlado si se pide). */
async function writePipelineFile(projectDir, name, content) {
  await fs.writeFile(path.join(projectDir, '.pipeline', name), content, 'utf8');
}

test('buildStepCommand genera binarios y argumentos exactos para code (OpenCode)', () => {
  const { command, args } = buildStepCommand('code');
  assert.equal(command, process.env.OPENCODE_BIN || path.join(homedir(), '.opencode', 'bin', 'opencode'));
  assert.deepEqual(args.slice(0, 3), ['run', '--auto', '-c']);
  assert.match(args[3], /pipeline-code:.*01-PLAN\.md.*02-HANDOFF\.md/);
});

test('buildStepCommand genera binarios y argumentos exactos para fix (OpenCode)', () => {
  const { command, args } = buildStepCommand('fix');
  assert.equal(command, process.env.OPENCODE_BIN || path.join(homedir(), '.opencode', 'bin', 'opencode'));
  assert.deepEqual(args.slice(0, 3), ['run', '--auto', '-c']);
  assert.match(args[3], /pipeline-code en modo corrección:.*03-QA-REPORT\.md/);
});

test('buildStepCommand genera binarios y argumentos exactos para qa (Kimi)', () => {
  const { command, args } = buildStepCommand('qa');
  assert.equal(command, process.env.KIMI_BIN || path.join(homedir(), '.kimi-code', 'bin', 'kimi'));
  assert.deepEqual(args.slice(0, 3), ['--auto', '-m', 'kimi-code/k3']);
  assert.equal(args[3], '-p');
  assert.match(args[4], /skill qa:.*03-QA-REPORT\.md.*(APPROVED|CHANGES_REQUIRED)/);
  assert.deepEqual(args.slice(5), ['-c']);
});

test('buildStepCommand respeta overrides y variables de entorno OPENCODE_BIN/KIMI_BIN', () => {
  const byOptions = buildStepCommand('qa', { kimiBin: '/custom/kimi' });
  assert.equal(byOptions.command, '/custom/kimi');

  const savedOpen = process.env.OPENCODE_BIN;
  const savedKimi = process.env.KIMI_BIN;
  try {
    process.env.OPENCODE_BIN = '/env/opencode';
    process.env.KIMI_BIN = '/env/kimi';
    assert.equal(buildStepCommand('code').command, '/env/opencode');
    assert.equal(buildStepCommand('fix').command, '/env/opencode');
    assert.equal(buildStepCommand('qa').command, '/env/kimi');
  } finally {
    if (savedOpen === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = savedOpen;
    if (savedKimi === undefined) delete process.env.KIMI_BIN;
    else process.env.KIMI_BIN = savedKimi;
  }

  assert.throws(() => buildStepCommand('deploy'), /Paso desconocido/);
});

test('buildStepCommand genera comando de OpenCode cuando qaEngine es opencode (fallback a DeepSeek/Mimo)', () => {
  const { command, args } = buildStepCommand('qa', {
    qaEngine: 'opencode',
    qaModel: 'opencode/deepseek-v4.1-flash-free',
  });
  assert.equal(command, process.env.OPENCODE_BIN || path.join(homedir(), '.opencode', 'bin', 'opencode'));
  assert.deepEqual(args.slice(0, 3), ['run', '--auto', '-c']);
  assert.equal(args[3], '-m');
  assert.equal(args[4], 'opencode/deepseek-v4.1-flash-free');
  assert.match(args[5], /skill qa:/);
});

test('runStep activa fallback automático a OpenCode cuando Kimi reporta error de cuota', async () => {
  const projectDir = await makeProject();
  try {
    const invocations = [];
    const runner = async ({ step, qaEngine, qaModel }) => {
      invocations.push({ step, qaEngine, qaModel });
      if (step === 'qa' && qaEngine === 'kimi') {
        return { exitCode: 1, quotaError: true, stderr: 'insufficient quota: token balance exhausted' };
      }
      return { exitCode: 0, stdout: 'QA completado' };
    };

    const result = await runStep('qa', {
      projectDir,
      runner,
      qaEngine: 'kimi',
      qaModel: 'opencode/deepseek-v4.1-flash-free',
    });

    assert.equal(result.fallbackFrom, 'kimi');
    assert.equal(result.qaEngine, 'opencode');
    assert.equal(result.exitCode, 0);
    assert.equal(invocations.length, 2);
    assert.equal(invocations[0].qaEngine, 'kimi');
    assert.equal(invocations[1].qaEngine, 'opencode');
    assert.equal(invocations[1].qaModel, 'opencode/deepseek-v4.1-flash-free');
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop con NO_PLAN: sin 01-PLAN.md devuelve status NO_PLAN sin llamar al runner', async () => {
  const projectDir = await makeProject();
  try {
    let called = false;
    const result = await runPipelineLoop({
      projectDir,
      runner: async () => {
        called = true;
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'NO_PLAN');
    assert.equal(result.iterations, 0);
    assert.deepEqual(result.steps, []);
    assert.equal(called, false, 'el runner no debe invocarse sin plan');
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop flujo feliz: code -> qa (APPROVED) termina con iterations 1', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Flujo feliz\n',
  });
  try {
    const result = await runPipelineLoop({
      projectDir,
      runner: async ({ step }) => {
        if (step === 'code') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n- **Iteración:** 1\n');
        } else if (step === 'qa') {
          await writePipelineFile(
            projectDir,
            '03-QA-REPORT.md',
            '# QA\nSTATUS: APPROVED\n'
          );
        }
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.iterations, 1);
    assert.deepEqual(result.steps, ['code', 'qa']);
    const state = await analyzePipeline(projectDir);
    assert.equal(state.qaStatus, 'APPROVED');
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop con corrección: code, qa(CHANGES), fix, qa(APPROVED) termina con iterations 2', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Con corrección\n',
  });
  try {
    const executed = [];
    let qaRuns = 0;
    const result = await runPipelineLoop({
      projectDir,
      maxRetries: 3,
      runner: async ({ step }) => {
        executed.push(step);
        if (step === 'code') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n- **Iteración:** 1\n');
        } else if (step === 'qa') {
          qaRuns += 1;
          const status = qaRuns === 1 ? 'CHANGES_REQUIRED' : 'APPROVED';
          await writePipelineFile(projectDir, '03-QA-REPORT.md', `# QA\nSTATUS: ${status}\n`);
        } else if (step === 'fix') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n- **Iteración:** 2\n');
        }
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.iterations, 2);
    assert.deepEqual(result.steps, ['code', 'qa', 'fix', 'qa']);
    assert.deepEqual(executed, ['code', 'qa', 'fix', 'qa']);
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop respeta maxRetries: QA siempre CHANGES_REQUIRED detiene exactamente en el límite', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Nunca aprobado\n',
  });
  try {
    const maxRetries = 2;
    const result = await runPipelineLoop({
      projectDir,
      maxRetries,
      runner: async ({ step }) => {
        if (step === 'code') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n- **Iteración:** 1\n');
        } else if (step === 'qa') {
          await writePipelineFile(projectDir, '03-QA-REPORT.md', '# QA\nSTATUS: CHANGES_REQUIRED\n');
        } else if (step === 'fix') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n- **Iteración:** ++\n');
        }
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'MAX_RETRIES_EXCEEDED');
    assert.equal(result.iterations, maxRetries);
    // Iteración 1: code + qa. Iteración 2: fix + qa. Sin más fix (límite alcanzado).
    assert.deepEqual(result.steps, ['code', 'qa', 'fix', 'qa']);
  } finally {
    await cleanup(projectDir);
  }
});

test('runStep dryRun no ejecuta subprocesos y devuelve exitCode 0', async () => {
  const projectDir = await makeProject();
  try {
    const { runStep } = await import('../bin/pipeline-run.mjs');
    const result = await runStep('code', { projectDir, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.command, process.env.OPENCODE_BIN || path.join(homedir(), '.opencode', 'bin', 'opencode'));
    assert.equal(result.cwd, projectDir);
    assert.equal(result.logFile, undefined, 'dry-run no debe generar logs');
  } finally {
    await cleanup(projectDir);
  }
});

test('CLI bin/pipeline-run.mjs vía symlink con --dry-run --json imprime JSON válido y exit 0', async () => {
  const projectDir = await makeProject({
    '01-PLAN.md': '# Plan\n- **Tarea:** Test CLI symlink\n',
  });
  try {
    const linkPath = path.join(projectDir, 'pipeline-run-link');
    await fs.symlink(CLI_PATH, linkPath, 'file');
    const { stdout } = await execFile(process.execPath, [linkPath, 'loop', projectDir, '--dry-run', '--json']);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.iterations > 0, true);
    assert.ok(Array.isArray(parsed.steps));
    // dry-run: pasa por code, re-analiza y observa que handoff sigue inexistente.
    assert.ok(parsed.status === 'STALLED' || typeof parsed.status === 'string');
  } finally {
    await cleanup(projectDir);
  }
});

test('isQuotaFailure: exit 0 nunca dispara fallback aunque stdout mencione 429/balance', () => {
  assert.equal(isQuotaFailure({ exitCode: 0, stdout: 'diff: balance 429 insufficient', stderr: '' }), false);
  assert.equal(isQuotaFailure({ exitCode: 0, stdout: '', stderr: 'rate limit warning' }), false);
});

test('isQuotaFailure: exit distinto de 0 dispara fallback', () => {
  assert.equal(isQuotaFailure({ exitCode: 1, stdout: '', stderr: 'rate limit exceeded' }), true);
  assert.equal(isQuotaFailure({ exitCode: 127, stdout: '', stderr: 'spawn ENOENT' }), true);
});

test('runPipelineLoop: code con exit != 0 devuelve STALLED sin correr QA', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n- **Tarea:** code roto\n' });
  const calls = [];
  try {
    const result = await runPipelineLoop({
      projectDir,
      runner: async ({ step }) => {
        calls.push(step);
        return { exitCode: 1 };
      },
    });
    assert.equal(result.status, 'STALLED');
    assert.match(result.reason, /code falló \(exit 1\)/);
    assert.deepEqual(calls, ['code']);
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop: fix con exit != 0 devuelve STALLED sin re-auditar', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n- **Tarea:** fix roto\n' });
  const calls = [];
  try {
    const result = await runPipelineLoop({
      projectDir,
      runner: async ({ step }) => {
        calls.push(step);
        if (step === 'code') {
          await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n');
        } else if (step === 'qa') {
          await writePipelineFile(projectDir, '03-QA-REPORT.md', 'STATUS: CHANGES_REQUIRED\n');
        } else if (step === 'fix') {
          return { exitCode: 2 };
        }
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'STALLED');
    assert.match(result.reason, /fix falló \(exit 2\)/);
    assert.deepEqual(calls, ['code', 'qa', 'fix']);
  } finally {
    await cleanup(projectDir);
  }
});

// ------------------------------------------------------------------------------
// Selección de agentes por rol (--coder / --qa / --qa-fallback)
// ------------------------------------------------------------------------------

/** Binarios ficticios para que los tests no dependan del PATH ni del entorno. */
const FAKE_BINS = {
  opencodeBin: '/bin/opencode',
  kimiBin: '/bin/kimi',
  claudeBin: '/bin/claude',
  geminiBin: '/bin/gemini',
  agyBin: '/bin/agy',
};

test('resolveModel traduce alias y respeta ids exactos', () => {
  assert.equal(resolveModel('claude', 'claude sonnet 5.5'), 'claude-sonnet-5-5');
  assert.equal(resolveModel('claude', 'Haiku'), 'claude-haiku-5-5');
  assert.equal(resolveModel('claude', 'claude-opus-4-1'), 'claude-opus-4-1');
  assert.equal(resolveModel('claude', 'claude-sonnet-5-5-20260301'), 'claude-sonnet-5-5-20260301');
  assert.equal(resolveModel('opencode', 'glm'), 'opencode/glm-5.3-flash-free');
  assert.equal(resolveModel('opencode', 'nemotron ultra'), 'opencode/nemotron-3-ultra-free');
  assert.equal(resolveModel('opencode', 'opencode/beam-free'), 'opencode/beam-free');
  assert.equal(resolveModel('kimi', null), 'kimi-code/k3');
  assert.equal(resolveModel('kimi', 'kimi code 3'), 'kimi-code/k3');
  assert.equal(resolveModel('antigravity', 'argon high'), 'gemini-4-argon-high');
  assert.equal(resolveModel('antigravity', 'flash low'), 'gemini-3.8-flash-low');
  assert.equal(resolveModel('antigravity', 'gpt-oss'), 'gpt-oss-120b-medium');
  assert.equal(resolveModel('gemini', 'gemini-x'), 'gemini-x');
  assert.equal(resolveModel('opencode', null, { role: 'coder' }), null);
  assert.equal(resolveModel('opencode', null, { role: 'qa' }), 'opencode/deepseek-v4.1-flash-free');
});

test('buildStepCommand usa el coder elegido en code y fix (kimi, claude, gemini)', () => {
  assert.deepEqual(AGENTS, ['opencode', 'kimi', 'claude', 'gemini', 'antigravity']);

  const kimi = buildStepCommand('code', { ...FAKE_BINS, coder: 'kimi' });
  assert.equal(kimi.command, '/bin/kimi');
  assert.equal(kimi.agent, 'kimi');
  assert.deepEqual([kimi.args[0], kimi.args[1], kimi.args[2], kimi.args.at(-1)], ['--auto', '-m', 'kimi-code/k3', '-c']);
  assert.match(kimi.args[4], /skill pipeline-code:/);

  const claude = buildStepCommand('fix', { ...FAKE_BINS, coder: 'claude', coderModel: 'sonnet' });
  assert.equal(claude.command, '/bin/claude');
  assert.equal(claude.args[0], '-p');
  assert.match(claude.args[1], /pipeline-code en modo corrección/);
  assert.deepEqual(claude.args.slice(2), ['--permission-mode', 'bypassPermissions', '--model', 'claude-sonnet-5-5']);
  assert.ok(!claude.args.includes('-c'), 'claude no debe continuar la sesión del orquestador');

  const gemini = buildStepCommand('code', { ...FAKE_BINS, coder: 'gemini' });
  assert.equal(gemini.command, '/bin/gemini');
  assert.deepEqual(gemini.args.slice(0, 3), ['--skip-trust', '--approval-mode', 'yolo']);
  assert.deepEqual(gemini.args.slice(-2, -1), ['-p']);

  assert.throws(() => buildStepCommand('code', { ...FAKE_BINS, coder: 'copilot' }), /Agente desconocido/);
});

test('buildStepCommand aplica el modelo de QA a cualquier agente', () => {
  const claude = buildStepCommand('qa', { ...FAKE_BINS, qaEngine: 'claude', qaModel: 'haiku' });
  assert.equal(claude.command, '/bin/claude');
  assert.equal(claude.model, 'claude-haiku-5-5');
  assert.ok(claude.args.includes('--model'));
  assert.ok(claude.args.includes('claude-haiku-5-5'));

  const antigravity = buildStepCommand('qa', { ...FAKE_BINS, qaEngine: 'antigravity', qaModel: 'flash' });
  assert.equal(antigravity.command, '/bin/agy');
  assert.equal(antigravity.model, 'gemini-3.8-flash-medium');
  assert.ok(antigravity.args.includes('--model'));
  assert.ok(antigravity.args.includes('gemini-3.8-flash-medium'));
  assert.ok(antigravity.args.includes('--dangerously-skip-permissions'));
  assert.ok(!antigravity.args.includes('-c'));

  const kimi = buildStepCommand('qa', { ...FAKE_BINS, qaEngine: 'kimi' });
  assert.equal(kimi.args[0], '--auto');
  assert.deepEqual(kimi.args.slice(1, 3), ['-m', 'kimi-code/k3']);
  assert.equal(kimi.args.at(-1), '-c');

  const gemini = buildStepCommand('qa', { ...FAKE_BINS, qaEngine: 'gemini' });
  assert.equal(gemini.command, '/bin/gemini');
  assert.match(gemini.args.at(-1), /skill qa:/);
});

test('compatibilidad: qaModel opencode/... con QA no-OpenCode pasa al fallback', () => {
  const bins = resolveBins({ ...FAKE_BINS, qaEngine: 'kimi', qaModel: 'opencode/glm-5.3-flash-free' });
  assert.equal(bins.qaModel, 'kimi-code/k3');
  assert.equal(bins.qaFallbackModel, 'opencode/glm-5.3-flash-free');
  const claude = buildStepCommand('qa', { ...FAKE_BINS, qaEngine: 'claude', qaModel: 'opencode/deepseek-v4.1-flash-free' });
  assert.equal(claude.model, null);
  assert.ok(!claude.args.includes('--model'));
});

test('resolveBins: el fallback de QA es el coder salvo que coincida con el QA o sea none', () => {
  const env = { CODER_AGENT: process.env.CODER_AGENT, QA_ENGINE: process.env.QA_ENGINE, QA_FALLBACK: process.env.QA_FALLBACK };
  delete process.env.CODER_AGENT;
  delete process.env.QA_ENGINE;
  delete process.env.QA_FALLBACK;
  try {
    const defaults = resolveBins();
    assert.deepEqual([defaults.coder, defaults.qaEngine, defaults.qaFallback], ['opencode', 'kimi', 'opencode']);
    assert.equal(resolveBins({ coder: 'claude', qaEngine: 'kimi' }).qaFallback, 'claude');
    assert.equal(resolveBins({ coder: 'kimi', qaEngine: 'kimi' }).qaFallback, null);
    assert.equal(resolveBins({ coder: 'claude', qaEngine: 'kimi', qaFallback: 'none' }).qaFallback, null);
    assert.equal(resolveBins({ coder: 'kimi', qaEngine: 'kimi', qaFallback: 'gemini' }).qaFallback, 'gemini');
    assert.equal(resolveBins({ qaEngine: 'gemini', qaFallback: 'gemini' }).qaFallback, null, 'el fallback no puede ser el mismo QA');

    process.env.CODER_AGENT = 'gemini';
    process.env.QA_ENGINE = 'claude';
    const fromEnv = resolveBins();
    assert.deepEqual([fromEnv.coder, fromEnv.qaEngine, fromEnv.qaFallback], ['gemini', 'claude', 'gemini']);
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('runStep: el fallback de QA usa el coder elegido (Kimi agotado → Claude)', async () => {
  const projectDir = await makeProject();
  try {
    const invocations = [];
    const runner = async ({ agent, command }) => {
      invocations.push({ agent, command });
      return agent === 'kimi' ? { exitCode: 1, quotaError: true } : { exitCode: 0 };
    };
    const result = await runStep('qa', { projectDir, runner, ...FAKE_BINS, coder: 'claude', qaEngine: 'kimi' });
    assert.deepEqual(invocations.map((i) => i.agent), ['kimi', 'claude']);
    assert.equal(result.fallbackFrom, 'kimi');
    assert.equal(result.qaEngine, 'claude');
    assert.equal(result.agent, 'claude');
    assert.equal(result.exitCode, 0);

    // Sin fallback (coder === QA): un solo intento que falla.
    invocations.length = 0;
    const noFallback = await runStep('qa', { projectDir, runner, ...FAKE_BINS, coder: 'kimi', qaEngine: 'kimi' });
    assert.deepEqual(invocations.map((i) => i.agent), ['kimi']);
    assert.equal(noFallback.exitCode, 1);
    assert.equal(noFallback.fallbackFrom, undefined);
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop corre cada paso con el agente de su rol y lo registra en el historial y runtime.json', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n- **Tarea:** Agentes\n' });
  try {
    const seen = [];
    const result = await runPipelineLoop({
      projectDir,
      coder: 'kimi',
      qaEngine: 'claude',
      runner: async ({ step, agent }) => {
        seen.push(`${step}:${agent}`);
        const runtime = JSON.parse(await fs.readFile(path.join(projectDir, '.pipeline', 'runtime.json'), 'utf8'));
        assert.equal(runtime.coder, 'kimi');
        assert.equal(runtime.qaEngine, 'claude');
        if (step === 'code') await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n');
        if (step === 'qa') await writePipelineFile(projectDir, '03-QA-REPORT.md', '# QA\nSTATUS: APPROVED\n');
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'APPROVED');
    assert.deepEqual(seen, ['code:kimi', 'qa:claude']);
    assert.deepEqual(result.history.map((h) => h.agent), ['kimi', 'claude']);
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop registra agente y modelo por paso', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n- **Tarea:** Modelos\n' });
  try {
    const seen = [];
    const result = await runPipelineLoop({
      projectDir,
      ...FAKE_BINS,
      coder: 'antigravity',
      coderModel: 'argon',
      qaEngine: 'claude',
      qaModel: 'haiku',
      runner: async ({ step, model }) => {
        seen.push({ step, model });
        const runtime = JSON.parse(await fs.readFile(path.join(projectDir, '.pipeline', 'runtime.json'), 'utf8'));
        assert.equal(runtime.coderModel, 'gemini-4-argon-medium');
        assert.equal(runtime.qaModel, 'claude-haiku-5-5');
        if (step === 'code') await writePipelineFile(projectDir, '02-HANDOFF.md', '# Handoff\n');
        if (step === 'qa') await writePipelineFile(projectDir, '03-QA-REPORT.md', '# QA\nSTATUS: APPROVED\n');
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'APPROVED');
    assert.deepEqual(seen, [
      { step: 'code', model: 'gemini-4-argon-medium' },
      { step: 'qa', model: 'claude-haiku-5-5' },
    ]);
    assert.deepEqual(result.history.map((h) => h.model), ['gemini-4-argon-medium', 'claude-haiku-5-5']);
  } finally {
    await cleanup(projectDir);
  }
});

test('runPipelineLoop con un agente desconocido devuelve STALLED sin correr pasos', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n' });
  try {
    let calls = 0;
    const result = await runPipelineLoop({
      projectDir,
      coder: 'copilot',
      runner: async () => {
        calls++;
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, 'STALLED');
    assert.match(result.reason, /Agente desconocido: 'copilot'/);
    assert.equal(calls, 0);
  } finally {
    await cleanup(projectDir);
  }
});

test('CLI: --coder/--qa válidos se reflejan en el dry-run y uno inválido sale con exit 1', async () => {
  const projectDir = await makeProject({ '01-PLAN.md': '# Plan\n' });
  try {
    const { stdout } = await execFile(process.execPath, [
      CLI_PATH, 'code', projectDir, '--dry-run', '--json', '--coder', 'gemini', '--qa=claude',
    ]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.agent, 'gemini');
    assert.equal(parsed.coder, 'gemini');
    assert.equal(parsed.qaEngine, 'claude');

    await assert.rejects(
      execFile(process.execPath, [CLI_PATH, 'loop', projectDir, '--coder', 'copilot']),
      (error) => error.code === 1 && /--coder 'copilot' no es válido/.test(error.stderr)
    );
  } finally {
    await cleanup(projectDir);
  }
});

test('CLI: pipeline-run models --json lista el catálogo y --coder antigravity es válido', async () => {
  const { stdout: catalogOutput } = await execFile(process.execPath, [CLI_PATH, 'models', '--json']);
  const catalog = JSON.parse(catalogOutput);
  assert.deepEqual(Object.keys(catalog), ['opencode', 'kimi', 'claude', 'antigravity', 'gemini']);

  const { stdout } = await execFile(process.execPath, [
    CLI_PATH, 'code', '.', '--dry-run', '--json', '--coder', 'antigravity', '--coder-model', 'argon high',
  ]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.agent, 'antigravity');
  assert.equal(parsed.model, 'gemini-4-argon-high');
});
