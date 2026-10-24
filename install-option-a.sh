#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Volumes/JeanFiles/code/Jean/multi-agent"
SKILLS_SRC="$REPO_DIR/skills"
COMMANDS_SRC="$REPO_DIR/commands/opencode"

echo "🚀 Instalando Opción A: Skills y Comandos del Pipeline Multi-Agente..."

# 1. Directorios globales de los 3 agentes
AGY_SKILLS="/Volumes/JeanFiles/.gemini/config/skills"
OPENCODE_SKILLS="/Volumes/JeanFiles/.config/opencode/skills"
OPENCODE_COMMANDS="/Volumes/JeanFiles/.config/opencode/commands"
KIMI_SKILLS="/Volumes/JeanFiles/.kimi-code/skills"
AGENTS_SHARED_SKILLS="/Volumes/JeanFiles/.agents/skills"

mkdir -p "$AGY_SKILLS" "$OPENCODE_SKILLS" "$OPENCODE_COMMANDS" "$KIMI_SKILLS" "$AGENTS_SHARED_SKILLS"

# 2. Enlazar Skills para Antigravity (Cerebro: pipeline-plan y pipeline-close)
ln -sfn "$SKILLS_SRC/pipeline-plan" "$AGY_SKILLS/pipeline-plan"
ln -sfn "$SKILLS_SRC/pipeline-close" "$AGY_SKILLS/pipeline-close"
echo "✅ Antigravity skills enlazadas: pipeline-plan, pipeline-close"

# 3. Enlazar Skill y Slash Commands (/code, /fix) para OpenCode
ln -sfn "$SKILLS_SRC/pipeline-code" "$OPENCODE_SKILLS/pipeline-code"
ln -sfn "$COMMANDS_SRC/code.md" "$OPENCODE_COMMANDS/code.md"
ln -sfn "$COMMANDS_SRC/fix.md" "$OPENCODE_COMMANDS/fix.md"
echo "✅ OpenCode skill (pipeline-code) y comandos (/code, /fix) enlazados"

# 4. Enlazar Skill (/qa) para Kimi Code
ln -sfn "$SKILLS_SRC/qa" "$KIMI_SKILLS/qa"
echo "✅ Kimi Code skill (/qa) enlazada"

# 5. Enlazar todas en ~/.agents/skills (estándar universal compartido)
for skill in pipeline-plan pipeline-code qa pipeline-close; do
  ln -sfn "$SKILLS_SRC/$skill" "$AGENTS_SHARED_SKILLS/$skill"
done
echo "✅ Estándar universal ~/.agents/skills actualizado"

# 6. Configurar .pipeline/ en el gitignore global para no ensuciar repositorios
GLOBAL_IGNORE="$(git config --global core.excludesfile || true)"
if [ -z "$GLOBAL_IGNORE" ]; then
  GLOBAL_IGNORE="$HOME/.gitignore_global"
  git config --global core.excludesfile "$GLOBAL_IGNORE"
fi
touch "$GLOBAL_IGNORE"
if ! grep -qxF ".pipeline/" "$GLOBAL_IGNORE"; then
  echo ".pipeline/" >> "$GLOBAL_IGNORE"
  echo "✅ '.pipeline/' añadido a tu gitignore global ($GLOBAL_IGNORE)"
else
  echo "ℹ️  '.pipeline/' ya estaba en tu gitignore global ($GLOBAL_IGNORE)"
fi

echo ""
echo "🎉 ¡Instalación de la Opción A completada con éxito!"
