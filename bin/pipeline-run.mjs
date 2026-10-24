#!/usr/bin/env node
/**
 * pipeline-run.mjs — Orquestador automático (Opción B) del flujo Multi-Agente.
 * Ejecuta de forma headless al coder (code/fix) y al QA elegidos —OpenCode, Kimi Code,
 * Claude Code o Gemini CLI; por defecto OpenCode + Kimi—, iterando hasta
 * `STATUS: APPROVED` en .pipeline/03-QA-REPORT.md o hasta --max-retries.
 * 100% Node.js nativo, sin dependencias externas.
 *
 * Uso: pipeline-run <loop|code|fix|qa> [dir] [--coder <agente>] [--qa <agente>] [--qa-fallback <agente|none>]
 *        [--coder-model <m>] [--qa-model <m>] [--max-retries N] [--dry-run] [--json]
 */
import { promises as fs, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { analyzePipeline } from './pipeline-status.mjs';

/** Binarios por defecto (sobreescribibles con OPENCODE_BIN, KIMI_BIN, CLAUDE_BIN y GEMINI_BIN). */
const FALLBACK_OPENCODE_BIN = path.join(homedir(), '.opencode', 'bin', 'opencode');
const FALLBACK_KIMI_BIN = path.join(homedir(), '.kimi-code', 'bin', 'kimi');
const DEFAULT_FALLBACK_QA_MODEL = 'opencode/deepseek-v4.1-flash-free';

const VALID_STEPS = new Set(['code', 'fix', 'qa']);

/** Agentes que pueden ocupar el rol de coder (code/fix) o de QA. */
export const AGENTS = ['opencode', 'kimi', 'claude', 'gemini'];
const DEFAULT_CODER = 'opencode';
const DEFAULT_QA = 'kimi';

const CODE_PROMPT = 'Activa la skill pipeline-code: lee .pipeline/01-PLAN.md, implementa todos los pasos, ejecuta los comandos de verificación y escribe .pipeline/02-HANDOFF.md';
const FIX_PROMPT = 'Activa la skill pipeline-code en modo corrección: lee .pipeline/03-QA-REPORT.md y .pipeline/01-PLAN.md, corrige todos los hallazgos, ejecuta las verificaciones y actualiza .pipeline/02-HANDOFF.md';
const QA_PROMPT = 'Activa la skill qa: audita únicamente el git diff contra .pipeline/01-PLAN.md y .pipeline/02-HANDOFF.md sin explorar el resto del repo y escribe .pipeline/03-QA-REPORT.md comenzando con STATUS: APPROVED o STATUS: CHANGES_REQUIRED';

/**
 * Busca un ejecutable en el PATH; si no lo encuentra devuelve el nombre tal cual
 * (spawn lo resolverá o fallará con exit 127 y el loop quedará en STALLED).
 * @param {string} name Nombre del ejecutable.
 * @returns {string}
 */
function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      realpathSync(candidate);
      return candidate;
    } catch {
      // Sigue buscando en el resto del PATH.
    }
  }
  return name;
}

/**
 * Valida un nombre de agente.
 * @param {unknown} agent
 * @returns {boolean}
 */
export function isValidAgent(agent) {
  return AGENTS.includes(agent);
}

/**
 * Resuelve los binarios y agentes a usar: options > variable de entorno > default.
 * `qaEngine` es el agente de QA (se mantiene el nombre por compatibilidad con la GUI y runtime.json).
 * `qaFallback` es el agente de respaldo si QA falla: por defecto el coder (si es distinto del QA); 'none' lo desactiva.
 * @param {{opencodeBin?: string, kimiBin?: string, claudeBin?: string, geminiBin?: string, coder?: string, qaEngine?: string, qaModel?: string, coderModel?: string, qaFallback?: string}} options
 * @returns {{opencodeBin: string, kimiBin: string, claudeBin: string, geminiBin: string, coder: string, qaEngine: string, qaModel: string, coderModel: string|null, qaFallback: string|null}}
 */
export function resolveBins(options = {}) {
  const coder = options.coder || process.env.CODER_AGENT || DEFAULT_CODER;
  const qaEngine = options.qaEngine || process.env.QA_ENGINE || DEFAULT_QA;
  const fallbackSetting = options.qaFallback || process.env.QA_FALLBACK || null;
  let qaFallback;
  if (fallbackSetting === 'none') qaFallback = null;
  else if (fallbackSetting) qaFallback = fallbackSetting;
  else qaFallback = coder !== qaEngine ? coder : null;
  return {
    opencodeBin: options.opencodeBin || process.env.OPENCODE_BIN || FALLBACK_OPENCODE_BIN,
    kimiBin: options.kimiBin || process.env.KIMI_BIN || FALLBACK_KIMI_BIN,
    claudeBin: options.claudeBin || process.env.CLAUDE_BIN || findOnPath('claude'),
    geminiBin: options.geminiBin || process.env.GEMINI_BIN || findOnPath('gemini'),
    coder,
    qaEngine,
    qaModel: options.qaModel || process.env.QA_MODEL || DEFAULT_FALLBACK_QA_MODEL,
    coderModel: options.coderModel || process.env.CODER_MODEL || null,
    qaFallback: qaFallback === qaEngine ? null : qaFallback,
  };
}

/**
 * Comando headless de un agente para un prompt. Todos corren en modo autónomo
 * (sin preguntas): el pipeline es no interactivo por diseño.
 * @param {string} agent Uno de AGENTS.
 * @param {string} prompt Instrucción para el agente.
 * @param {string|null} model Modelo opcional.
 * @param {ReturnType<typeof resolveBins>} bins Binarios resueltos.
 * @returns {{command: string, args: string[]}}
 */
function buildAgentCommand(agent, prompt, model, bins) {
  const modelArgs = (flag) => (model ? [flag, model] : []);
  switch (agent) {
    case 'opencode':
      return { command: bins.opencodeBin, args: ['run', '--auto', '-c', ...modelArgs('-m'), prompt] };
    case 'kimi':
      return { command: bins.kimiBin, args: ['--auto', ...modelArgs('-m'), '-p', prompt, '-c'] };
    case 'claude':
      // Sin -c: continuaría la sesión del propio orquestador si /auto corre en Claude Code.
      return { command: bins.claudeBin, args: ['-p', prompt, '--permission-mode', 'bypassPermissions', ...modelArgs('--model')] };
    case 'gemini':
      return { command: bins.geminiBin, args: ['--skip-trust', '--approval-mode', 'yolo', ...modelArgs('-m'), '-p', prompt] };
    default:
      throw new Error(`Agente desconocido: '${agent}'. Válidos: ${AGENTS.join(' | ')}`);
  }
}

/**
 * Genera el comando exacto de cada paso del pipeline según el agente elegido para el rol.
 * @param {'code'|'fix'|'qa'} step Paso a ejecutar.
 * @param {Parameters<typeof resolveBins>[0]} options Sobreescritura de binarios/agentes/modelos.
 * @returns {{command: string, args: string[], agent: string}}
 */
export function buildStepCommand(step, options = {}) {
  const bins = resolveBins(options);
  if (!VALID_STEPS.has(step)) {
    throw new Error(`Paso desconocido: '${step}'. Válidos: ${[...VALID_STEPS].join(' | ')}`);
  }
  if (step === 'qa') {
    const agent = bins.qaEngine;
    // Kimi como QA conserva su invocación histórica ('-p <prompt> -c').
    if (agent === 'kimi') return { command: bins.kimiBin, args: ['-p', QA_PROMPT, '-c'], agent };
    // qaModel (DeepSeek free por defecto) es el modelo de OpenCode en QA; los demás usan su modelo por defecto.
    return { ...buildAgentCommand(agent, QA_PROMPT, agent === 'opencode' ? bins.qaModel : null, bins), agent };
  }
  const agent = bins.coder;
  return { ...buildAgentCommand(agent, step === 'code' ? CODE_PROMPT : FIX_PROMPT, bins.coderModel, bins), agent };
}

/**
 * Ruta del binario de un agente, para validar que exista antes de lanzar el loop.
 * @param {string} agent
 * @param {ReturnType<typeof resolveBins>} bins
 * @returns {string}
 */
function agentBin(agent, bins) {
  return { opencode: bins.opencodeBin, kimi: bins.kimiBin, claude: bins.claudeBin, gemini: bins.geminiBin }[agent];
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
 * @param {{running: boolean, action?: string|null, step?: string|null, iteration?: number, coder?: string|null, qaEngine?: string|null, status?: string|null}} data
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
      coder: data.coder ?? null,
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
 * Decide si un paso de QA con Kimi falló de verdad y amerita fallback.
 * Un exit 0 nunca dispara fallback (el stdout contiene el diff auditado y puede
 * mencionar "429" o "balance" sin que sea un error). Solo un exit != 0 (cuota
 * agotada, crash, binario roto) activa el fallback.
 * @param {{exitCode: number, stdout?: string, stderr?: string}} outcome
 * @returns {boolean}
 */
export function isQuotaFailure(outcome = {}) {
  if (outcome.exitCode === 0) return false;
  return true;
}

/**
 * Ejecuta un paso del pipeline (code | fix | qa) con soporte de fallback automático en QA.
 * Si `!dryRun`, publica telemetría best-effort en `.pipeline/runtime.json`
 * (`running: true` antes del agente y `running: false` al terminar).
 * @param {'code'|'fix'|'qa'} step
 * @param {{projectDir: string, runner?: Function, dryRun?: boolean, coder?: string, qaEngine?: string, qaModel?: string, coderModel?: string, qaFallback?: string, iteration?: number, runtimeAction?: string}} deps
 * @returns {Promise<{step: string, command: string, args: string[], cwd: string, dryRun: boolean, exitCode: number, agent: string, logFile?: string, fallbackFrom?: string, qaEngine?: string, [key: string]: unknown}>}
 */
export async function runStep(step, {
  projectDir, runner, dryRun = false, coder, qaEngine, qaModel, coderModel, qaFallback, iteration = 1, runtimeAction,
} = {}) {
  if (!VALID_STEPS.has(step)) {
    throw new Error(`Paso desconocido: '${step}'. Válidos: ${[...VALID_STEPS].join(' | ')}`);
  }
  const stepOptions = { coder, qaEngine, qaModel, coderModel, qaFallback };
  const bins = resolveBins(stepOptions);
  const { command, args, agent } = buildStepCommand(step, stepOptions);
  const cwd = projectDir;

  if (dryRun) {
    return { step, command, args, cwd, dryRun: true, exitCode: 0, agent, coder: bins.coder, qaEngine: bins.qaEngine };
  }

  const result = { step, command, args, cwd, dryRun: false, agent, coder: bins.coder, qaEngine: bins.qaEngine };
  // `runtimeAction: 'loop'` lo inyecta runPipelineLoop para que la telemetría
  // distinga una corrida orquestada de un paso suelto lanzado desde la GUI/CLI.
  const runtimeBase = { action: runtimeAction || step, step, iteration, coder: bins.coder };
  await writeRuntimeState(projectDir, { ...runtimeBase, running: true, qaEngine: result.qaEngine });

  // Fallback de QA: si el agente de QA falla (cuota, crash), reintenta con qaFallback.
  const fallbackAgent = step === 'qa' ? bins.qaFallback : null;
  const fallbackCommand = () => buildStepCommand('qa', { ...stepOptions, qaEngine: fallbackAgent, qaFallback: 'none' });

  try {
    if (runner) {
      const injected = await runner({ step, command, args, cwd, agent, qaEngine: bins.qaEngine, qaModel });
      // Soporte de fallback en runner inyectado si simula error de cuota:
      if (fallbackAgent && injected?.quotaError) {
        const fallbackCmd = fallbackCommand();
        const fallbackResult = await runner({
          step,
          command: fallbackCmd.command,
          args: fallbackCmd.args,
          cwd,
          agent: fallbackAgent,
          qaEngine: fallbackAgent,
          qaModel: bins.qaModel,
        });
        result.qaEngine = fallbackAgent;
        return {
          ...result,
          ...fallbackResult,
          command: fallbackCmd.command,
          args: fallbackCmd.args,
          agent: fallbackAgent,
          exitCode: fallbackResult?.exitCode ?? 0,
          fallbackFrom: bins.qaEngine,
          qaEngine: fallbackAgent,
        };
      }
      return { ...result, exitCode: injected?.exitCode ?? 0, ...injected };
    }

    // Ejecución real con spawn + log en .pipeline/logs/.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(projectDir, '.pipeline', 'logs', `${timestamp}-${step}.log`);
    const outcome = await spawnAndLog(command, args, cwd, logFile);

    if (fallbackAgent && isQuotaFailure(outcome)) {
      console.error(`⚠️ ${bins.qaEngine} reportó error o cuota agotada en QA (exit ${outcome.exitCode}). Activando fallback de QA con ${fallbackAgent}...`);
      const fallbackCmd = fallbackCommand();
      const fallbackOutcome = await spawnAndLog(fallbackCmd.command, fallbackCmd.args, cwd, logFile);
      result.qaEngine = fallbackAgent;
      return {
        ...result,
        command: fallbackCmd.command,
        args: fallbackCmd.args,
        agent: fallbackAgent,
        exitCode: fallbackOutcome.exitCode,
        stdout: fallbackOutcome.stdout,
        stderr: fallbackOutcome.stderr,
        error: fallbackOutcome.error,
        logFile,
        fallbackFrom: bins.qaEngine,
        qaEngine: fallbackAgent,
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
 * @param {{projectDir: string, maxRetries?: number, runner?: Function, dryRun?: boolean, coder?: string, qaEngine?: string, qaModel?: string, coderModel?: string, qaFallback?: string, onEvent?: Function}} deps
 * @returns {Promise<{status: 'APPROVED'|'MAX_RETRIES_EXCEEDED'|'NO_PLAN'|'STALLED', iterations: number, history: Array<object>, steps: string[], finalState?: object}>}
 */
export async function runPipelineLoop({
  projectDir,
  maxRetries = 3,
  runner,
  dryRun = false,
  coder,
  qaEngine,
  qaModel,
  coderModel,
  qaFallback,
  onEvent,
} = {}) {
  const agentOptions = { coder, qaEngine, qaModel, coderModel, qaFallback };
  const bins = resolveBins(agentOptions);
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
        coder: bins.coder,
        qaEngine: bins.qaEngine,
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
      coder: bins.coder,
      qaEngine: bins.qaEngine,
    });
  };

  for (const agent of [bins.coder, bins.qaEngine, bins.qaFallback].filter(Boolean)) {
    if (!isValidAgent(agent)) {
      return finish({
        status: 'STALLED', iterations: 0, history, steps,
        reason: `Agente desconocido: '${agent}'. Válidos: ${AGENTS.join(' | ')}`,
      });
    }
  }

  if (!dryRun && runner === undefined) {
    // Validación temprana: verifica los binarios del coder y del QA elegidos
    // (el fallback de QA es opcional: si falta, solo fallará ese reintento).
    for (const agent of new Set([bins.coder, bins.qaEngine])) {
      const bin = agentBin(agent, bins);
      try {
        await fs.access(bin);
      } catch {
        return finish({
          status: 'STALLED',
          iterations: 0,
          history,
          steps,
          reason: `Binario de ${agent} no encontrado: ${bin} (configura ${agent.toUpperCase()}_BIN)`,
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
        projectDir, runner, dryRun, ...agentOptions, iteration, runtimeAction: 'loop',
      });
      history.push({ iteration, step: 'code', agent: result.agent, exitCode: result.exitCode });
      steps.push('code');
      notify({ type: 'step_end', step: 'code', iteration, result });
      if (result.exitCode !== 0) {
        return finish({
          status: 'STALLED', iterations: iteration, history, steps, finalState: state,
          reason: `code falló (exit ${result.exitCode})`,
        });
      }
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
        projectDir, runner, dryRun, ...agentOptions, iteration, runtimeAction: 'loop',
      });
      history.push({
        iteration,
        step: 'qa',
        agent: result.agent,
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
        projectDir, runner, dryRun, ...agentOptions, iteration, runtimeAction: 'loop',
      });
      history.push({ iteration, step: 'fix', agent: result.agent, exitCode: result.exitCode });
      steps.push('fix');
      notify({ type: 'step_end', step: 'fix', iteration, result });
      if (result.exitCode !== 0) {
        return finish({
          status: 'STALLED', iterations: iteration, history, steps, finalState: state,
          reason: `fix falló (exit ${result.exitCode})`,
        });
      }
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
    } else if (['--qa', '--qa-engine'].includes(arg) || arg.startsWith('--qa=') || arg.startsWith('--qa-engine=')) {
      flags.qaEngine = arg.includes('=') ? arg.split('=')[1] : argv[++i];
    } else if (arg === '--coder' || arg.startsWith('--coder=')) {
      flags.coder = arg.includes('=') ? arg.split('=')[1] : argv[++i];
    } else if (arg === '--qa-fallback' || arg.startsWith('--qa-fallback=')) {
      flags.qaFallback = arg.includes('=') ? arg.split('=')[1] : argv[++i];
    } else if (arg === '--coder-model' || arg.startsWith('--coder-model=')) {
      flags.coderModel = arg.includes('=') ? arg.split('=')[1] : argv[++i];
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
    const agent = entry.agent ? ` · ${entry.agent}${entry.fallbackFrom ? ` (fallback de ${entry.fallbackFrom})` : ''}` : '';
    lines.push(`  [iter ${entry.iteration}] ${entry.step}${agent} (exit ${entry.exitCode})`);
  }
  return lines.filter(Boolean).join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [command, dirArg = '.'] = positional;

  const usage = `Uso: pipeline-run <loop|code|fix|qa> [dir] [--coder ${AGENTS.join('|')}] [--qa ${AGENTS.join('|')}] [--qa-fallback <agente|none>] [--coder-model <m>] [--qa-model <m>] [--max-retries N] [--dry-run] [--json]`;
  if (!command || !['loop', 'code', 'fix', 'qa'].includes(command)) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  for (const [flag, value] of [['--coder', flags.coder], ['--qa', flags.qaEngine], ['--qa-fallback', flags.qaFallback]]) {
    if (value !== undefined && !isValidAgent(value) && !(flag === '--qa-fallback' && value === 'none')) {
      console.error(`${flag} '${value}' no es válido. Agentes: ${AGENTS.join(' | ')}${flag === '--qa-fallback' ? ' | none' : ''}\n${usage}`);
      process.exitCode = 1;
      return;
    }
  }
  const agentFlags = {
    coder: flags.coder,
    qaEngine: flags.qaEngine,
    qaModel: flags.qaModel,
    coderModel: flags.coderModel,
    qaFallback: flags.qaFallback,
  };

  const projectDir = path.resolve(dirArg);

  if (command === 'loop') {
    const result = await runPipelineLoop({
      projectDir,
      maxRetries: flags.maxRetries ?? 3,
      dryRun: flags.dryRun,
      ...agentFlags,
      onEvent: flags.json ? undefined : (event) => {
        if (event.type === 'step_end') {
          console.error(`▶ ${event.step} · ${event.result.agent} (iter ${event.iteration}) exit ${event.result.exitCode}`);
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
    ...agentFlags,
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatLoopResult({ ...result, status: `STEP_${command.toUpperCase()}`, iterations: 1, history: [{ iteration: 1, step: command, agent: result.agent, fallbackFrom: result.fallbackFrom, exitCode: result.exitCode }], steps: [command], reason: result.error }, projectDir));
  }
  process.exitCode = result.exitCode === 0 ? 0 : 1;
}

if (isMainEntry()) {
  await main();
}
