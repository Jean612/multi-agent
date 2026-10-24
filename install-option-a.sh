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

# 2. Enlazar Skills para Antigravity (Cerebro: pipeline-plan, pipeline-close y pipeline-auto)
ln -sfn "$SKILLS_SRC/pipeline-plan" "$AGY_SKILLS/pipeline-plan"
ln -sfn "$SKILLS_SRC/pipeline-close" "$AGY_SKILLS/pipeline-close"
ln -sfn "$SKILLS_SRC/pipeline-auto" "$AGY_SKILLS/pipeline-auto"
echo "✅ Antigravity skills enlazadas: pipeline-plan, pipeline-close, pipeline-auto"

# 3. Enlazar Skill y Slash Commands (/code, /fix) para OpenCode
ln -sfn "$SKILLS_SRC/pipeline-code" "$OPENCODE_SKILLS/pipeline-code"
ln -sfn "$COMMANDS_SRC/code.md" "$OPENCODE_COMMANDS/code.md"
ln -sfn "$COMMANDS_SRC/fix.md" "$OPENCODE_COMMANDS/fix.md"
echo "✅ OpenCode skill (pipeline-code) y comandos (/code, /fix) enlazados"

# 4. Enlazar Skill (/qa) para Kimi Code
ln -sfn "$SKILLS_SRC/qa" "$KIMI_SKILLS/qa"
echo "✅ Kimi Code skill (/qa) enlazada"

# 5. Enlazar todas en ~/.agents/skills (estándar universal compartido)
for skill in pipeline-plan pipeline-code qa pipeline-close pipeline-auto; do
  ln -sfn "$SKILLS_SRC/$skill" "$AGENTS_SHARED_SKILLS/$skill"
done
echo "✅ Estándar universal ~/.agents/skills actualizado"

# 6. Enlazar los CLIs del orquestador en el PATH del usuario
LOCAL_BIN="/Volumes/JeanFiles/.local/bin"
mkdir -p "$LOCAL_BIN"
ln -sfn "$REPO_DIR/bin/pipeline-status.mjs" "$LOCAL_BIN/pipeline-status"
ln -sfn "$REPO_DIR/bin/pipeline-run.mjs" "$LOCAL_BIN/pipeline-run"
echo "✅ CLIs enlazados: pipeline-status, pipeline-run ($LOCAL_BIN)"

# 7. Configurar .pipeline/ en el gitignore global para no ensuciar repositorios
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
