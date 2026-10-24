#!/usr/bin/env node
/**
 * pipeline-run.mjs — Orquestador automático (Opción B) del flujo Multi-Agente.
 * Ejecuta de forma headless a OpenCode (code/fix) y Kimi Code (qa), iterando
 * hasta `STATUS: APPROVED` en .pipeline/03-QA-REPORT.md o hasta --max-retries.
 * 100% Node.js nativo, sin dependencias externas.
 *
 * Uso: pipeline-run <loop|code|fix|qa> [dir] [--max-retries N] [--dry-run] [--json]
 */
import { promises as fs, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { analyzePipeline } from './pipeline-status.mjs';

/** Binarios por defecto (sobreescribibles con OPENCODE_BIN y KIMI_BIN). */
const FALLBACK_OPENCODE_BIN = path.join(homedir(), '.opencode', 'bin', 'opencode');
const FALLBACK_KIMI_BIN = path.join(homedir(), '.kimi-code', 'bin', 'kimi');
const DEFAULT_FALLBACK_QA_MODEL = 'opencode/deepseek-v4.1-flash-free';

const VALID_STEPS = new Set(['code', 'fix', 'qa']);

/**
 * Resuelve los binarios y motores a usar: options > variable de entorno > fallback.
 * @param {{opencodeBin?: string, kimiBin?: string, qaEngine?: 'kimi'|'opencode', qaModel?: string}} options
 * @returns {{opencodeBin: string, kimiBin: string, qaEngine: 'kimi'|'opencode', qaModel: string}}
 */
export function resolveBins(options = {}) {
  return {
    opencodeBin: options.opencodeBin || process.env.OPENCODE_BIN || FALLBACK_OPENCODE_BIN,
    kimiBin: options.kimiBin || process.env.KIMI_BIN || FALLBACK_KIMI_BIN,
    qaEngine: options.qaEngine || process.env.QA_ENGINE || 'kimi',
    qaModel: options.qaModel || process.env.QA_MODEL || DEFAULT_FALLBACK_QA_MODEL,
  };
}

/**
 * Genera el comando exacto de cada paso del pipeline.
 * @param {'code'|'fix'|'qa'} step Paso a ejecutar.
 * @param {{opencodeBin?: string, kimiBin?: string, qaEngine?: 'kimi'|'opencode', qaModel?: string}} options Sobreescritura de binarios/motor.
 * @returns {{command: string, args: string[]}}
 */
export function buildStepCommand(step, options = {}) {
  const { opencodeBin, kimiBin, qaEngine, qaModel } = resolveBins(options);
  switch (step) {
    case 'code':
      return {
        command: opencodeBin,
        args: [
          'run', '--auto', '-c',
          'Activa la skill pipeline-code: lee .pipeline/01-PLAN.md, implementa todos los pasos, ejecuta los comandos de verificación y escribe .pipeline/02-HANDOFF.md',
        ],
      };
    case 'fix':
      return {
        command: opencodeBin,
        args: [
          'run', '--auto', '-c',
          'Activa la skill pipeline-code en modo corrección: lee .pipeline/03-QA-REPORT.md y .pipeline/01-PLAN.md, corrige todos los hallazgos, ejecuta las verificaciones y actualiza .pipeline/02-HANDOFF.md',
        ],
      };
    case 'qa':
      if (qaEngine === 'opencode') {
        return {
          command: opencodeBin,
          args: [
            'run', '--auto', '-c',
            '-m', qaModel,
            'Activa la skill qa: audita únicamente el git diff contra .pipeline/01-PLAN.md y .pipeline/02-HANDOFF.md sin explorar el resto del repo y escribe .pipeline/03-QA-REPORT.md comenzando con STATUS: APPROVED o STATUS: CHANGES_REQUIRED',
          ],
        };
      }
      return {
        command: kimiBin,
        args: [
          '-p',
          'Activa la skill qa: audita únicamente el git diff contra .pipeline/01-PLAN.md y .pipeline/02-HANDOFF.md sin explorar el resto del repo y escribe .pipeline/03-QA-REPORT.md comenzando con STATUS: APPROVED o STATUS: CHANGES_REQUIRED',
          '-c',
        ],
      };
    default:
      throw new Error(`Paso desconocido: '${step}'. Válidos: ${[...VALID_STEPS].join(' | ')}`);
  }
}

/**
 * Añade contenido al log del paso. Un fallo al escribir el log no aborta el pipeline.
 * @param {string} logFile Ruta absoluta del log.
 * @param {string} content Contenido a añadir.
 */
async function appendLog(logFile, content) {
  try {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.appendFile(logFile, content, 'utf8');
  } catch {
    // El log es best-effort.
  }
}

/**
 * Escribe el estado en vivo del pipeline en `.pipeline/runtime.json` (best-effort).
 * Es la telemetría pasiva que lee Mission Control para iluminarse cuando el loop
 * corre en otro proceso (p. ej. lanzado por Antigravity vía CLI).
 * Nunca lanza: si el filesystem falla, el pipeline continúa.
 * @param {string} projectDir Directorio del proyecto.
 * @param {{running: boolean, action?: string|null, step?: string|null, iteration?: number, qaEngine?: string|null, status?: string|null}} data
 * @returns {Promise<void>}
 */
export async function writeRuntimeState(projectDir, data = {}) {
  try {
    const pipelineDir = path.join(projectDir, '.pipeline');
    await fs.mkdir(pipelineDir, { recursive: true });
    const payload = {
      running: data.running === true,
      action: data.action ?? null,
      step: data.step ?? null,
      iteration: Number.isFinite(data.iteration) ? data.iteration : 1,
      qaEngine: data.qaEngine ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (data.status) payload.status = data.status;
    await fs.writeFile(
      path.join(pipelineDir, 'runtime.json'),
      JSON.stringify(payload, null, 2) + '\n',
      'utf8'
    );
  } catch {
    // La telemetría es best-effort: nunca debe romper el pipeline.
  }
}

/**
 * Ejecuta un proceso hijo con spawn y loguea stdout/stderr.
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} logFile
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, error?: string}>}
 */
async function spawnAndLog(command, args, cwd, logFile) {
  await appendLog(logFile, `$ ${command} ${args.map((a) => JSON.stringify(a)).join(' ')}\n\n`);
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let writeChain = Promise.resolve();
  const streamChunk = (chunk) => {
    const text = chunk.toString('utf8');
    writeChain = writeChain.then(() => appendLog(logFile, text));
  };
  const outcome = await new Promise((resolve) => {
    const chunks = { stdout: [], stderr: [] };
    child.stdout.on('data', (chunk) => {
      chunks.stdout.push(chunk);
      streamChunk(chunk);
    });
    child.stderr.on('data', (chunk) => {
      chunks.stderr.push(chunk);
      streamChunk(chunk);
    });
    child.on('error', (error) => {
      resolve({ exitCode: 127, stdout: '', stderr: error.message, error: error.message });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      });
    });
  });
  await writeChain;
  await appendLog(logFile, `\n--- exit code: ${outcome.exitCode} ---\n`);
  return outcome;
}

/**
 * Ejecuta un paso del pipeline (code | fix | qa) con soporte de fallback automático en QA.
 * Si `!dryRun`, publica telemetría best-effort en `.pipeline/runtime.json`
 * (`running: true` antes del agente y `running: false` al terminar).
 * @param {'code'|'fix'|'qa'} step
 * @param {{projectDir: string, runner?: Function, dryRun?: boolean, qaEngine?: 'kimi'|'opencode', qaModel?: string, iteration?: number, runtimeAction?: string}} deps
 * @returns {Promise<{step: string, command: string, args: string[], cwd: string, dryRun: boolean, exitCode: number, logFile?: string, fallbackFrom?: string, qaEngine?: string, [key: string]: unknown}>}
 */
export async function runStep(step, { projectDir, runner, dryRun = false, qaEngine, qaModel, iteration = 1, runtimeAction } = {}) {
  if (!VALID_STEPS.has(step)) {
    throw new Error(`Paso desconocido: '${step}'. Válidos: ${[...VALID_STEPS].join(' | ')}`);
  }
  let stepOptions = { qaEngine, qaModel };
  let { command, args } = buildStepCommand(step, stepOptions);
  const cwd = projectDir;

  if (dryRun) {
    return { step, command, args, cwd, dryRun: true, exitCode: 0, qaEngine: resolveBins(stepOptions).qaEngine };
  }

  const result = { step, command, args, cwd, dryRun: false, qaEngine: resolveBins(stepOptions).qaEngine };
  // `runtimeAction: 'loop'` lo inyecta runPipelineLoop para que la telemetría
  // distinga una corrida orquestada de un paso suelto lanzado desde la GUI/CLI.
  const runtimeBase = { action: runtimeAction || step, step, iteration };
  await writeRuntimeState(projectDir, { ...runtimeBase, running: true, qaEngine: result.qaEngine });

  try {
    if (runner) {
      const injected = await runner({ step, command, args, cwd, qaEngine: resolveBins(stepOptions).qaEngine, qaModel });
      // Soporte de fallback en runner inyectado si simula error de cuota en Kimi:
      if (step === 'qa' && resolveBins(stepOptions).qaEngine === 'kimi' && injected?.quotaError) {
        stepOptions.qaEngine = 'opencode';
        const fallbackCmd = buildStepCommand('qa', stepOptions);
        const fallbackResult = await runner({
          step,
          command: fallbackCmd.command,
          args: fallbackCmd.args,
          cwd,
          qaEngine: 'opencode',
          qaModel: resolveBins(stepOptions).qaModel,
        });
        result.qaEngine = 'opencode';
        return {
          ...result,
          ...fallbackResult,
          command: fallbackCmd.command,
          args: fallbackCmd.args,
          exitCode: fallbackResult?.exitCode ?? 0,
          fallbackFrom: 'kimi',
          qaEngine: 'opencode',
        };
      }
      return { ...result, exitCode: injected?.exitCode ?? 0, ...injected };
    }

    // Ejecución real con spawn + log en .pipeline/logs/.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(projectDir, '.pipeline', 'logs', `${timestamp}-${step}.log`);
    let outcome = await spawnAndLog(command, args, cwd, logFile);

    // Fallback automático en QA: si Kimi falla o agota tokens, reintenta con OpenCode (DeepSeek/Mimo)
    const isKimiQuotaError =
      step === 'qa' &&
      resolveBins(stepOptions).qaEngine === 'kimi' &&
      (outcome.exitCode !== 0 ||
        /quota|rate\s*limit|insufficient|balance|token\s*limit|429/i.test(`${outcome.stdout} ${outcome.stderr}`));

    if (isKimiQuotaError) {
      const chosenModel = resolveBins(stepOptions).qaModel;
      console.error(`⚠️ Kimi Code reportó error o cuota agotada (exit ${outcome.exitCode}). Activando fallback de QA con OpenCode (${chosenModel})...`);
      stepOptions.qaEngine = 'opencode';
      const fallbackCmd = buildStepCommand('qa', stepOptions);
      const fallbackOutcome = await spawnAndLog(fallbackCmd.command, fallbackCmd.args, cwd, logFile);
      result.qaEngine = 'opencode';
      return {
        ...result,
        command: fallbackCmd.command,
        args: fallbackCmd.args,
        exitCode: fallbackOutcome.exitCode,
        stdout: fallbackOutcome.stdout,
        stderr: fallbackOutcome.stderr,
        error: fallbackOutcome.error,
        logFile,
        fallbackFrom: 'kimi',
        qaEngine: 'opencode',
      };
    }

    return { ...result, ...outcome, logFile };
  } finally {
    await writeRuntimeState(projectDir, { ...runtimeBase, running: false, qaEngine: result.qaEngine });
  }
}

/**
 * Ejecuta el bucle completo del pipeline: code -> qa (-> fix -> qa)* hasta APPROVED.
 * Respeta estrictamente maxRetries para prevenir bucles infinitos y usa mtimes/estados.
 * @param {{projectDir: string, maxRetries?: number, runner?: Function, dryRun?: boolean, qaEngine?: 'kimi'|'opencode', qaModel?: string, onEvent?: Function}} deps
 * @returns {Promise<{status: 'APPROVED'|'MAX_RETRIES_EXCEEDED'|'NO_PLAN'|'STALLED', iterations: number, history: Array<object>, steps: string[], finalState?: object}>}
 */
export async function runPipelineLoop({
  projectDir,
  maxRetries = 3,
  runner,
  dryRun = false,
  qaEngine,
  qaModel,
  onEvent,
} = {}) {
  const notify = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };
  const history = [];
  const steps = [];

  /** Cierra la telemetría del loop (best-effort) y devuelve el resultado. */
  const finish = async (result) => {
    if (!dryRun) {
      await writeRuntimeState(projectDir, {
        running: false,
        action: 'loop',
        step: null,
        iteration: result.iterations ?? 0,
        status: result.status,
        qaEngine: resolveBins({ qaEngine, qaModel }).qaEngine,
      });
    }
    return result;
  };

  /** Marca el inicio de un paso del loop en runtime.json (los pasos sueltos lo hacen en runStep). */
  const markStepStart = async (stepName, iterationNumber) => {
    if (dryRun) return;
    await writeRuntimeState(projectDir, {
      running: true,
      action: 'loop',
      step: stepName,
      iteration: iterationNumber,
      qaEngine: resolveBins({ qaEngine, qaModel }).qaEngine,
    });
  };

  if (!dryRun && runner === undefined) {
    // Validación temprana: verifica binarios según motor de QA.
    const { opencodeBin, kimiBin, qaEngine: resolvedQaEngine } = resolveBins({ qaEngine, qaModel });
    const requiredBins = [opencodeBin];
    if (resolvedQaEngine === 'kimi') requiredBins.push(kimiBin);
    for (const bin of new Set(requiredBins)) {
      try {
        await fs.access(bin);
      } catch {
        return finish({
          status: 'STALLED',
          iterations: 0,
          history,
          steps,
          reason: `Binario no encontrado: ${bin} (configura OPENCODE_BIN/KIMI_BIN)`,
        });
      }
    }
  }

  let state = await analyzePipeline(projectDir);
  if (!state.planExists) {
    return finish({ status: 'NO_PLAN', iterations: 0, history, steps });
  }

  // mustRunQa: tras code/fix el handoff es siempre "nuevo" para QA. Evita el caso
  // borde donde el filesystem coalescea mtimes (granularidad gruesa) y el chequeo
  // estricto handoffMtime > qaMtime fallaría, causando un loop sin QA.
  let mustRunQa = false;

  for (let iteration = 1; iteration <= maxRetries; iteration++) {
    // 1) Si falta el handoff, corre 'code'.
    if (!state.handoffExists) {
      notify({ type: 'step_start', step: 'code', iteration });
      await markStepStart('code', iteration);
      const result = await runStep('code', {
        projectDir, runner, dryRun, qaEngine, qaModel, iteration, runtimeAction: 'loop',
      });
      history.push({ iteration, step: 'code', exitCode: result.exitCode });
      steps.push('code');
      notify({ type: 'step_end', step: 'code', iteration, result });
      state = await analyzePipeline(projectDir);
    }

    // 2) Corre 'qa' si no hay reporte, o si el handoff cambió después del QA.
    //    mustRunQa fuerza QA aunque el FS no notice el cambio de mtime.
    if (
      state.handoffExists &&
      (!state.qaExists || state.handoffMtime > state.qaMtime || mustRunQa)
    ) {
      notify({ type: 'step_start', step: 'qa', iteration });
      await markStepStart('qa', iteration);
      const result = await runStep('qa', {
        projectDir, runner, dryRun, qaEngine, qaModel, iteration, runtimeAction: 'loop',
      });
      history.push({
        iteration,
        step: 'qa',
        exitCode: result.exitCode,
        engine: result.qaEngine,
        fallbackFrom: result.fallbackFrom,
      });
      steps.push('qa');
      notify({ type: 'step_end', step: 'qa', iteration, result });
      state = await analyzePipeline(projectDir);
      mustRunQa = false;
    }

    // 3) Decisiones según el estado del reporte de QA.
    if (state.qaStatus === 'APPROVED') {
      return finish({ status: 'APPROVED', iterations: iteration, history, steps, finalState: state });
    }
    if (state.qaStatus === 'CHANGES_REQUIRED') {
      if (iteration >= maxRetries) {
        return finish({ status: 'MAX_RETRIES_EXCEEDED', iterations: iteration, history, steps, finalState: state });
      }
      notify({ type: 'step_start', step: 'fix', iteration });
      await markStepStart('fix', iteration);
      const result = await runStep('fix', {
        projectDir, runner, dryRun, qaEngine, qaModel, iteration, runtimeAction: 'loop',
      });
      history.push({ iteration, step: 'fix', exitCode: result.exitCode });
      steps.push('fix');
      notify({ type: 'step_end', step: 'fix', iteration, result });
      mustRunQa = true;
      continue; // En la siguiente vuelta se corre 'qa' de nuevo.
    }

    // Estado no resoluble: ni aprobado ni corrección pedida, sin pasos pendientes.
    return finish({
      status: 'STALLED',
      iterations: iteration,
      history,
      steps,
      finalState: state,
      reason: 'QA no devolvió APPROVED ni CHANGES_REQUIRED (reporte ausente o STATUS desconocido)',
    });
  }

  return finish({ status: 'MAX_RETRIES_EXCEEDED', iterations: maxRetries, history, steps, finalState: state });
}

/**
 * Detiene si el módulo se ejecuta como CLI, también vía symlink global
 * (realpathSync sobre argv[1] para resolver la ruta real del archivo).
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

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--max-retries' || arg.startsWith('--max-retries=')) {
      const value = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      const n = Number.parseInt(value, 10);
      flags.maxRetries = Number.isFinite(n) && n > 0 ? n : 3;
    } else if (arg === '--qa-engine' || arg.startsWith('--qa-engine=')) {
      flags.qaEngine = arg.includes('=') ? arg.split('=')[1] : argv[++i];
    } else if (arg === '--qa-model' || arg.startsWith('--qa-model=')) {
      flags.qaModel = arg.includes('=') ? arg.split('=')[1] : argv[++i];
    } else if (!arg.startsWith('--')) positional.push(arg);
  }
  return { positional, flags };
}

function formatLoopResult(result, projectDir) {
  const lines = [
    'Pipeline Multi-Agente — ejecución orquestada',
    '='.repeat(52),
    `Directorio:        ${projectDir}`,
    `Estado final:      ${result.status}`,
    `Iteraciones:       ${result.iterations}`,
    `Pasos ejecutados:  ${result.steps.length > 0 ? result.steps.join(' -> ') : '(ninguno)'}`,
    result.reason ? `Motivo:            ${result.reason}` : '',
    '-'.repeat(52),
  ];
  for (const entry of result.history) {
    lines.push(`  [iter ${entry.iteration}] ${entry.step} (exit ${entry.exitCode})`);
  }
  return lines.filter(Boolean).join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [command, dirArg = '.'] = positional;

  if (!command || !['loop', 'code', 'fix', 'qa'].includes(command)) {
    console.error('Uso: pipeline-run <loop|code|fix|qa> [dir] [--max-retries N] [--qa-engine kimi|opencode] [--qa-model <model>] [--dry-run] [--json]');
    process.exitCode = 1;
    return;
  }

  const projectDir = path.resolve(dirArg);

  if (command === 'loop') {
    const result = await runPipelineLoop({
      projectDir,
      maxRetries: flags.maxRetries ?? 3,
      dryRun: flags.dryRun,
      qaEngine: flags.qaEngine,
      qaModel: flags.qaModel,
      onEvent: flags.json ? undefined : (event) => {
        if (event.type === 'step_end') {
          console.error(`▶ ${event.step} (iter ${event.iteration}) exit ${event.result.exitCode}`);
        }
      },
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatLoopResult(result, projectDir));
    }
    process.exitCode = flags.dryRun || result.status === 'APPROVED' ? 0 : 1;
    return;
  }

  const result = await runStep(command, {
    projectDir,
    dryRun: flags.dryRun,
    qaEngine: flags.qaEngine,
    qaModel: flags.qaModel,
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatLoopResult({ ...result, status: `STEP_${command.toUpperCase()}`, iterations: 1, history: [{ iteration: 1, step: command, exitCode: result.exitCode }], steps: [command], reason: result.error }, projectDir));
  }
  process.exitCode = result.exitCode === 0 ? 0 : 1;
}

if (isMainEntry()) {
  await main();
}
