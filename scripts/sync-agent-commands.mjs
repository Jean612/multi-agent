#!/usr/bin/env node
/**
 * sync-agent-commands.mjs — Genera los slash commands del pipeline para los agentes
 * que no leen `commands/*.md` (fuente única, la que usan Claude Code y OpenCode):
 *
 *   - agent-commands/skills/<cmd>/SKILL.md → Kimi Code y Antigravity (`agy`), donde
 *     cada skill es un comando `/<cmd>`.
 *   - agent-commands/gemini/<cmd>.toml     → Gemini CLI (`~/.gemini/commands`).
 *
 * `/qa` no se genera como skill: la skill `qa` real ya es el comando `/qa`.
 * 100% Node.js nativo, sin dependencias externas.
 *
 * Uso: node scripts/sync-agent-commands.mjs [--check]
 *   --check  No escribe; sale con código 1 si algún archivo generado está desactualizado.
 */
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = path.join(REPO_DIR, 'commands');
const OUT_SKILLS_DIR = path.join(REPO_DIR, 'agent-commands', 'skills');
const OUT_GEMINI_DIR = path.join(REPO_DIR, 'agent-commands', 'gemini');

/** Comandos cuya skill real ya tiene el mismo nombre: no se duplican como skill-comando. */
const SKILL_ALREADY_IS_COMMAND = new Set(['qa']);

const GENERATED_NOTICE = 'Generado por scripts/sync-agent-commands.mjs desde commands/';

/**
 * Separa el frontmatter (`description`) del cuerpo de un comando de Claude/OpenCode.
 * @param {string} text Contenido de commands/<cmd>.md.
 * @returns {{description: string, body: string}}
 */
export function parseCommand(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { description: '', body: text.trim() };
  const descLine = match[1].split('\n').find((line) => line.startsWith('description:')) ?? '';
  const description = descLine.replace(/^description:\s*/, '').replace(/^["']|["']$/g, '');
  return { description, body: match[2].trim() };
}

/**
 * Cuerpo de una skill-comando: `$ARGUMENTS` no existe fuera de Claude/OpenCode, así que se
 * reemplaza por una instrucción para usar el texto escrito después del comando.
 * @param {string} name Nombre del comando.
 * @param {string} body Cuerpo del comando original.
 * @returns {string}
 */
function toSkillBody(name, body) {
  const argsNote = `**Argumentos:** usa el texto que el usuario escribió después de \`/${name}\`, si lo hay.`;
  return body
    .split('\n')
    .map((line) => (line.trim() === '$ARGUMENTS' ? argsNote : line.replaceAll('$ARGUMENTS', 'los argumentos del comando')))
    .join('\n');
}

/**
 * Contenido de `agent-commands/skills/<name>/SKILL.md`.
 * `disable-model-invocation` evita que el agente la active solo al ver una tarea de código.
 * @param {string} name
 * @param {{description: string, body: string}} command
 * @returns {string}
 */
export function renderSkill(name, { description, body }) {
  const desc = `Comando /${name} del Pipeline Multi-Agente — ${description}`.replaceAll('"', '\\"');
  return [
    '---',
    `name: ${name}`,
    `description: "${desc}"`,
    'disable-model-invocation: true',
    '---',
    '',
    `<!-- ${GENERATED_NOTICE}${name}.md. No editar a mano. -->`,
    '',
    toSkillBody(name, body),
    '',
  ].join('\n');
}

/**
 * Contenido de `agent-commands/gemini/<name>.toml` (Gemini CLI: `prompt` + `description`,
 * con `{{args}}` como comodín de los argumentos).
 * @param {string} name
 * @param {{description: string, body: string}} command
 * @returns {string}
 */
export function renderGeminiToml(name, { description, body }) {
  const escapeBasic = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const prompt = body.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('\\', '\\\\').replaceAll('"""', '\\"\\"\\"');
  return [
    `# ${GENERATED_NOTICE}${name}.md. No editar a mano.`,
    `description = "${escapeBasic(description)}"`,
    `prompt = """`,
    prompt,
    `"""`,
    '',
  ].join('\n');
}

/**
 * Calcula todos los archivos generados a partir de commands/*.md.
 * @returns {Promise<Map<string, string>>} Ruta absoluta → contenido esperado.
 */
export async function buildOutputs() {
  const entries = (await fs.readdir(COMMANDS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  const outputs = new Map();
  for (const file of entries) {
    const name = file.replace(/\.md$/, '');
    const command = parseCommand(await fs.readFile(path.join(COMMANDS_DIR, file), 'utf8'));
    if (!SKILL_ALREADY_IS_COMMAND.has(name)) {
      outputs.set(path.join(OUT_SKILLS_DIR, name, 'SKILL.md'), renderSkill(name, command));
    }
    outputs.set(path.join(OUT_GEMINI_DIR, `${name}.toml`), renderGeminiToml(name, command));
  }
  return outputs;
}

/**
 * Escribe los archivos generados, o en modo `check` informa cuáles están desactualizados.
 * @param {{check?: boolean}} [opts]
 * @returns {Promise<string[]>} Rutas (relativas al repo) desactualizadas o escritas.
 */
export async function syncAgentCommands({ check = false } = {}) {
  const changed = [];
  for (const [file, content] of await buildOutputs()) {
    let current = null;
    try {
      current = await fs.readFile(file, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) continue;
    changed.push(path.relative(REPO_DIR, file));
    if (!check) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
    }
  }
  return changed;
}

/** Detecta si el módulo se ejecuta como CLI (también vía symlink). */
function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isMainEntry()) {
  const check = process.argv.includes('--check');
  const changed = await syncAgentCommands({ check });
  if (check && changed.length > 0) {
    console.error(`Comandos de agentes desactualizados (corre: node scripts/sync-agent-commands.mjs):\n  ${changed.join('\n  ')}`);
    process.exitCode = 1;
  } else if (!check) {
    console.log(changed.length > 0 ? `Actualizados:\n  ${changed.join('\n  ')}` : 'Sin cambios.');
  }
}
