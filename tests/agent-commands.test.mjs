/**
 * Tests de scripts/sync-agent-commands.mjs: los slash commands generados para Kimi Code,
 * Antigravity (skills-comando) y Gemini CLI (TOML) deben estar sincronizados con commands/*.md.
 * 100% Node.js nativo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommand, renderGeminiToml, renderSkill, syncAgentCommands } from '../scripts/sync-agent-commands.mjs';

const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Nombres de los comandos fuente (commands/*.md). */
async function commandNames() {
  const files = await fs.readdir(path.join(REPO_DIR, 'commands'), { withFileTypes: true });
  return files.filter((f) => f.isFile() && f.name.endsWith('.md')).map((f) => f.name.replace(/\.md$/, '')).sort();
}

test('agent-commands/ está sincronizado con commands/*.md (correr el script si falla)', async () => {
  assert.deepEqual(await syncAgentCommands({ check: true }), []);
});

test('cada comando tiene su TOML de Gemini y, salvo /qa, su skill-comando', async () => {
  const names = await commandNames();
  assert.deepEqual(names, ['auto', 'close', 'code', 'epic', 'fix', 'plan', 'qa']);
  for (const name of names) {
    const toml = await fs.readFile(path.join(REPO_DIR, 'agent-commands', 'gemini', `${name}.toml`), 'utf8');
    assert.match(toml, /^description = ".+"$/m, `${name}.toml sin description`);
    assert.match(toml, /^prompt = """\n[\s\S]+\n"""\n$/m, `${name}.toml sin prompt`);
    assert.ok(toml.includes('{{args}}'), `${name}.toml no pasa los argumentos`);
    assert.ok(!toml.includes('$ARGUMENTS'), `${name}.toml conserva $ARGUMENTS`);

    const skillPath = path.join(REPO_DIR, 'agent-commands', 'skills', name, 'SKILL.md');
    if (name === 'qa') {
      await assert.rejects(fs.access(skillPath), 'qa no se duplica: la skill qa real ya es /qa');
      continue;
    }
    const skill = await fs.readFile(skillPath, 'utf8');
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`), `${name}: name no coincide con la carpeta`);
    assert.match(skill, /^disable-model-invocation: true$/m, `${name}: el agente no debe activarla solo`);
    assert.ok(!skill.includes('$ARGUMENTS'), `${name}: conserva $ARGUMENTS`);
    assert.match(skill, new RegExp(`después de \`/${name}\``));
  }
});

test('parseCommand y los renders transforman $ARGUMENTS según el agente', () => {
  const command = parseCommand('---\ndescription: "Fase X: algo"\n---\n\nTarea indicada en $ARGUMENTS.\n$ARGUMENTS\n');
  assert.equal(command.description, 'Fase X: algo');
  assert.equal(command.body, 'Tarea indicada en $ARGUMENTS.\n$ARGUMENTS');

  const skill = renderSkill('demo', command);
  assert.match(skill, /Tarea indicada en los argumentos del comando\./);
  assert.match(skill, /\*\*Argumentos:\*\* usa el texto que el usuario escribió después de `\/demo`/);

  const toml = renderGeminiToml('demo', { description: 'con "comillas"', body: 'a\\b """x""" $ARGUMENTS' });
  assert.match(toml, /^description = "con \\"comillas\\""$/m);
  assert.ok(toml.includes('a\\\\b \\"\\"\\"x\\"\\"\\" {{args}}'), 'escapa barras y triples comillas del TOML');
});

test('install.sh enlaza los comandos en Kimi (sin /plan ni /auto internos), Antigravity y Gemini CLI', async () => {
  const install = await fs.readFile(path.join(REPO_DIR, 'install.sh'), 'utf8');
  assert.match(install, /link_command_skills "\$KIMI_SKILLS" plan auto/);
  assert.match(install, /link_command_skills "\$AGY_SKILLS"\n/);
  assert.match(install, /link_all_skills "\$KIMI_SKILLS"/);
  assert.match(install, /link_all_skills "\$AGY_SKILLS"/);
  assert.match(install, /GEMINI_COMMANDS="\$USER_HOME\/\.gemini\/commands"/);
});
