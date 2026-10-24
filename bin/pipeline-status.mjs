#!/usr/bin/env node
/**
 * pipeline-status.mjs — Inspecciona el estado del flujo Multi-Agente (.pipeline/)
 * 100% Node.js nativo, sin dependencias externas.
 *
 * Uso: node bin/pipeline-status.mjs [dir] [--json]
 */
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLAN_FILE = '01-PLAN.md';
const HANDOFF_FILE = '02-HANDOFF.md';
const QA_FILE = '03-QA-REPORT.md';

/**
 * Siguiente paso por rol (Cerebro, Coder, QA), sin nombrar agentes: cada rol lo
 * ocupa el agente/modelo que elija el usuario y puede cambiar entre tareas.
 */
const NEXT_STEPS = {
  NO_PLAN: '1. Cerebro: genera el plan con /plan (o lanza /auto)',
  NO_HANDOFF: '2. Coder: ejecuta /code',
  NO_QA: '3. QA: ejecuta /qa',
  CHANGES_REQUIRED: '2. Coder: ejecuta /fix para corregir las observaciones de QA',
  RE_QA: '3. QA: re-ejecuta /qa sobre las correcciones',
  UNKNOWN_QA: '3. QA: re-ejecuta /qa (STATUS no reconocido en 03-QA-REPORT.md)',
  APPROVED: '4. Cerebro: ejecuta /close (pipeline-close)',
};

/**
 * Extrae el valor de una clave con el formato `- **Clave:** valor` dentro de un texto.
 * @param {string} text Contenido del archivo.
 * @param {string} key Nombre de la clave (ej. "Tarea", "Iteración").
 * @returns {string|null} Valor encontrado sin recortar espacios, o null si no existe.
 */
function extractField(text, key) {
  const match = text.match(new RegExp(`^-\\s*\\*\\*${key}:\\*\\*\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

/**
 * Extrae el valor de `STATUS: ...` (sin guion ni negritas) dentro de un texto.
 * @param {string} text Contenido del archivo.
 * @returns {string|null} Valor de STATUS en mayúsculas (APPROVED | CHANGES_REQUIRED) o null.
 */
function extractStatus(text) {
  // Solo el encabezado: el veredicto va al inicio; citas posteriores no cuentan.
  const head = text.split('\n').slice(0, 10).join('\n');
  const match = head.match(/^\s*[-*]?\s*\**STATUS:\**\s*([A-Z_]+)/m);
  return match ? match[1] : null;
}

/**
 * Devuelve el mtime en ms de un archivo, o null si no existe/accesible.
 * @param {string} filePath Ruta absoluta del archivo.
 * @returns {Promise<number|null>}
 */
async function getMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Función pura: analiza un directorio de proyecto y devuelve el estado del pipeline.
 * No lanza excepciones cuando faltan archivos o la carpeta `.pipeline/` completa.
 * @param {string} projectDir Directorio raíz del proyecto a inspeccionar.
 * @returns {Promise<{projectDir: string, pipelineDir: string, planExists: boolean, task: string|null, handoffExists: boolean, iteration: string|null, handoffMtime: number|null, qaExists: boolean, qaStatus: string|null, qaMtime: number|null, nextStep: string}>}
 */
export async function analyzePipeline(projectDir) {
  const pipelineDir = path.join(projectDir, '.pipeline');
  const planPath = path.join(pipelineDir, PLAN_FILE);
  const handoffPath = path.join(pipelineDir, HANDOFF_FILE);
  const qaPath = path.join(pipelineDir, QA_FILE);

  const [planExists, handoffExists, qaExists] = await Promise.all([
    fs
      .access(planPath)
      .then(() => true)
      .catch(() => false),
    fs
      .access(handoffPath)
      .then(() => true)
      .catch(() => false),
    fs
      .access(qaPath)
      .then(() => true)
      .catch(() => false),
  ]);

  let task = null;
  if (planExists) {
    try {
      task = extractField(await fs.readFile(planPath, 'utf8'), 'Tarea');
    } catch {
      task = null;
    }
  }

  let iteration = null;
  let handoffMtime = null;
  if (handoffExists) {
    try {
      const content = await fs.readFile(handoffPath, 'utf8');
      iteration = extractField(content, 'Iteración');
    } catch {
      iteration = null;
    }
    handoffMtime = await getMtime(handoffPath);
  }

  let qaStatus = null;
  let qaMtime = null;
  if (qaExists) {
    try {
      qaStatus = extractStatus(await fs.readFile(qaPath, 'utf8'));
    } catch {
      qaStatus = null;
    }
    qaMtime = await getMtime(qaPath);
  }

  let nextStep;
  if (!planExists) {
    nextStep = NEXT_STEPS.NO_PLAN;
  } else if (!handoffExists) {
    nextStep = NEXT_STEPS.NO_HANDOFF;
  } else if (!qaExists) {
    nextStep = NEXT_STEPS.NO_QA;
  } else if (qaStatus === 'CHANGES_REQUIRED') {
    // Caso borde: si el handoff fue modificado DESPUÉS del reporte de QA,
    // el coder ya resolvió las observaciones y toca re-auditar (no re-fix).
    nextStep =
      handoffMtime !== null && qaMtime !== null && handoffMtime > qaMtime
        ? NEXT_STEPS.RE_QA
        : NEXT_STEPS.CHANGES_REQUIRED;
  } else if (qaStatus === 'APPROVED') {
    nextStep = NEXT_STEPS.APPROVED;
  } else {
    // STATUS desconocido o ausente en el reporte de QA: no se puede avanzar con certeza.
    nextStep = NEXT_STEPS.UNKNOWN_QA;
  }

  return {
    projectDir,
    pipelineDir,
    planExists,
    task,
    handoffExists,
    iteration,
    handoffMtime,
    qaExists,
    qaStatus,
    qaMtime,
    nextStep,
  };
}

/**
 * Renderiza el estado en un resumen legible en texto plano.
 * @param {Awaited<ReturnType<typeof analyzePipeline>>} state Estado del pipeline.
 * @returns {string}
 */
function formatText(state) {
  const lines = [
    'Pipeline Multi-Agente — estado de .pipeline/',
    '='.repeat(52),
    `Directorio:       ${state.projectDir}`,
    `01-PLAN.md:       ${state.planExists ? 'existe' : 'faltante'}`,
    `- Tarea:          ${state.task ?? '(sin extraer)'}`,
    `02-HANDOFF.md:    ${state.handoffExists ? 'existe' : 'faltante'}`,
    `- Iteración:      ${state.iteration ?? '(sin extraer)'}`,
    `03-QA-REPORT.md:  ${state.qaExists ? 'existe' : 'faltante'}`,
    `- STATUS:         ${state.qaStatus ?? '(sin extraer)'}`,
    '-'.repeat(52),
    `Siguiente paso:   ${state.nextStep}`,
  ];
  return lines.join('\n');
}

/**
 * Punto de entrada CLI.
 * @param {string[]} argv Argumentos de process.argv (sin node ni el script).
 */
export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const dirArg = argv.find((arg) => arg !== '--json') ?? '.';
  const projectDir = path.resolve(dirArg);

  const state = await analyzePipeline(projectDir);

  if (json) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log(formatText(state));
  }
}

/**
 * Detecta si el módulo se ejecuta directamente como script (CLI).
 * Resuelve el realpath de process.argv[1] para que la detección funcione también
 * cuando el binario se invoca a través de un enlace simbólico (ej. ~/.local/bin/pipeline-status),
 * donde argv[1] mantiene la ruta del symlink mientras import.meta.url apunta a la real.
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

// Al ejecutarse directamente como script (directo o vía symlink) se corre el CLI; al importarse (tests) no.
if (isMainEntry()) {
  await main();
}
