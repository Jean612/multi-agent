#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Multi-Agent & Claude Code Pipeline — Instalador Universal Portable
# Compatible con: macOS, Ubuntu / Debian, CachyOS (Omarchy) / Arch, Fedora, etc.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/skills"
COMMANDS_SRC="$SCRIPT_DIR/commands"
BIN_SRC="$SCRIPT_DIR/bin"

USER_HOME="${HOME:-$HOME}"
LOCAL_BIN="$USER_HOME/.local/bin"

# Valores por defecto para flags
MODE=""
CLAUDE_DIR=""
DRY_RUN=false

# ------------------------------------------------------------------------------
# 1. Parseo de argumentos de línea de comandos (modo no interactivo / CI)
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode|-m)
      MODE="$2"
      shift 2
      ;;
    --claude-dir|-c)
      CLAUDE_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      echo "Uso: ./install.sh [opciones]"
      echo ""
      echo "Opciones:"
      echo "  -m, --mode <multi|claude>   Perfil de instalación (multi: todos los agentes; claude: solo Claude Code)"
      echo "  -c, --claude-dir <ruta>     Directorio de config de Claude (ej: ~/.claude o ~/.claude-cf)"
      echo "  --dry-run                   Muestra las operaciones sin crear enlaces"
      echo "  -h, --help                  Muestra esta ayuda"
      exit 0
      ;;
    *)
      echo "⚠️  Opción desconocida: $1"
      exit 1
      ;;
  esac
done

# Función helper para expandir tilde (~) en rutas
expand_path() {
  local input="$1"
  if [[ "$input" == ~* ]]; then
    echo "${input/#\~/$USER_HOME}"
  elif [[ "$input" == /* ]]; then
    echo "$input"
  else
    echo "$USER_HOME/$input"
  fi
}

safe_link() {
  local src="$1"
  local dest="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] ln -sfn \"$src\" \"$dest\""
  else
    mkdir -p "$(dirname "$dest")"
    ln -sfn "$src" "$dest"
  fi
}

# ------------------------------------------------------------------------------
# 2. Menú Interactivo (si no se pasaron flags por línea de comandos)
# ------------------------------------------------------------------------------
if [ -z "$MODE" ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "🚀 Instalador del Pipeline Multi-Agente / Claude Code"
  echo "══════════════════════════════════════════════════════════════════════"
  echo "Detectado SO: $(uname -s) | Usuario: $(whoami) | Home: $USER_HOME"
  echo ""
  echo "Selecciona el perfil de instalación:"
  echo "  [1] Multi-Agente Completo"
  echo "      (Antigravity + OpenCode + Kimi Code + Claude Code + ~/.agents/skills)"
  echo "      -> Ideal para tu Mac personal o laptop personal con Linux (Omarchy/CachyOS)."
  echo ""
  echo "  [2] Solo Claude Code (Corporativo / Trabajo)"
  echo "      -> Sin OpenCode ni Kimi Code. Instala exclusivamente en tu carpeta de Claude."
  echo "      -> Te permite elegir la carpeta de config (ej. ~/.claude o ~/.claude-cf)."
  echo ""
  read -r -p "Ingresa una opción [1 o 2, por defecto 1]: " OPTION_CHOICE
  OPTION_CHOICE="${OPTION_CHOICE:-1}"

  if [ "$OPTION_CHOICE" = "2" ]; then
    MODE="claude"
  else
    MODE="multi"
  fi
fi

# Preguntar por la carpeta de Claude si no se especificó con flag
if [ -z "$CLAUDE_DIR" ]; then
  if [ "$MODE" = "claude" ]; then
    echo ""
    echo "Tu empresa o personalización puede usar una carpeta custom de Claude."
    read -r -p "¿Qué carpeta de Claude usas? [Enter para ~/.claude o escribe ej: ~/.claude-cf]: " INPUT_CLAUDE_DIR
    CLAUDE_DIR="${INPUT_CLAUDE_DIR:-~/.claude}"
  else
    # En multi por defecto se usa ~/.claude si no especifica otra
    read -r -p "¿Carpeta de Claude Code? [Enter para ~/.claude o escribe ej: ~/.claude-cf / 'skip' para omitir]: " INPUT_CLAUDE_DIR
    CLAUDE_DIR="${INPUT_CLAUDE_DIR:-~/.claude}"
  fi
fi

CLAUDE_TARGET_DIR=""
if [ "$CLAUDE_DIR" != "skip" ] && [ -n "$CLAUDE_DIR" ]; then
  CLAUDE_TARGET_DIR="$(expand_path "$CLAUDE_DIR")"
fi

echo ""
echo "⚙️  Iniciando instalación en modo: [$MODE]..."

# ------------------------------------------------------------------------------
# 3. Instalación de Comandos y Skills en Claude Code (si aplica)
# ------------------------------------------------------------------------------
if [ -n "$CLAUDE_TARGET_DIR" ]; then
  CLAUDE_SKILLS="$CLAUDE_TARGET_DIR/skills"
  CLAUDE_COMMANDS="$CLAUDE_TARGET_DIR/commands"
  mkdir -p "$CLAUDE_SKILLS" "$CLAUDE_COMMANDS"

  echo "📦 Enlazando skills en Claude Code ($CLAUDE_TARGET_DIR)..."
  for skill_path in "$SKILLS_SRC"/*; do
    if [ -d "$skill_path" ]; then
      skill_name="$(basename "$skill_path")"
      safe_link "$skill_path" "$CLAUDE_SKILLS/$skill_name"
    fi
  done

  echo "⚡ Enlazando slash commands (/epic, /plan, /auto, /code, /fix, /qa, /close) en Claude Code..."
  for cmd_file in "$COMMANDS_SRC"/*.md; do
    if [ -f "$cmd_file" ]; then
      cmd_name="$(basename "$cmd_file")"
      safe_link "$cmd_file" "$CLAUDE_COMMANDS/$cmd_name"
    fi
  done
  echo "✅ Claude Code configurado con éxito en: $CLAUDE_TARGET_DIR"
fi

# ------------------------------------------------------------------------------
# 4. Instalación de los demás agentes (Solo en modo 'multi')
# ------------------------------------------------------------------------------
if [ "$MODE" = "multi" ]; then
  echo ""
  echo "📦 Enlazando configuración para Antigravity, OpenCode y Kimi Code..."

  # Directorios dinámicos basados en $USER_HOME
  AGY_SKILLS="$USER_HOME/.gemini/config/skills"
  OPENCODE_SKILLS="$USER_HOME/.config/opencode/skills"
  OPENCODE_COMMANDS="$USER_HOME/.config/opencode/commands"
  KIMI_SKILLS="$USER_HOME/.kimi-code/skills"
  AGENTS_SHARED_SKILLS="$USER_HOME/.agents/skills"

  # Antigravity
  mkdir -p "$AGY_SKILLS"
  for s in pipeline-epic pipeline-plan pipeline-close pipeline-auto; do
    if [ -d "$SKILLS_SRC/$s" ]; then
      safe_link "$SKILLS_SRC/$s" "$AGY_SKILLS/$s"
    fi
  done
  echo "✅ Antigravity skills enlazadas ($AGY_SKILLS)"

  # OpenCode (skills y slash commands)
  mkdir -p "$OPENCODE_SKILLS" "$OPENCODE_COMMANDS"
  safe_link "$SKILLS_SRC/pipeline-code" "$OPENCODE_SKILLS/pipeline-code"
  for cmd_file in "$COMMANDS_SRC"/*.md; do
    if [ -f "$cmd_file" ]; then
      cmd_name="$(basename "$cmd_file")"
      safe_link "$cmd_file" "$OPENCODE_COMMANDS/$cmd_name"
    fi
  done
  echo "✅ OpenCode skills y comandos enlazados ($OPENCODE_SKILLS)"

  # Kimi Code
  mkdir -p "$KIMI_SKILLS"
  for s in qa pipeline-plan pipeline-code; do
    if [ -d "$SKILLS_SRC/$s" ]; then
      safe_link "$SKILLS_SRC/$s" "$KIMI_SKILLS/$s"
    fi
  done
  echo "✅ Kimi Code skills (qa, pipeline-plan, pipeline-code) enlazadas ($KIMI_SKILLS)"

  # Estándar universal compartido ~/.agents/skills
  mkdir -p "$AGENTS_SHARED_SKILLS"
  for skill_path in "$SKILLS_SRC"/*; do
    if [ -d "$skill_path" ]; then
      skill_name="$(basename "$skill_path")"
      safe_link "$skill_path" "$AGENTS_SHARED_SKILLS/$skill_name"
    fi
  done
  echo "✅ Estándar universal enlazado ($AGENTS_SHARED_SKILLS)"
fi

# ------------------------------------------------------------------------------
# 5. Enlazar herramientas CLI en $HOME/.local/bin
# ------------------------------------------------------------------------------
mkdir -p "$LOCAL_BIN"
safe_link "$BIN_SRC/pipeline-status.mjs" "$LOCAL_BIN/pipeline-status"
safe_link "$BIN_SRC/pipeline-run.mjs" "$LOCAL_BIN/pipeline-run"
safe_link "$BIN_SRC/pipeline-ui.mjs" "$LOCAL_BIN/pipeline-ui"
echo "✅ Binarios CLI enlazados en $LOCAL_BIN (pipeline-status, pipeline-run, pipeline-ui)"

# ------------------------------------------------------------------------------
# 6. Gitignore global para aislar .pipeline/ localmente
# ------------------------------------------------------------------------------
GLOBAL_IGNORE="$(git config --global core.excludesfile || true)"
if [ -z "$GLOBAL_IGNORE" ]; then
  GLOBAL_IGNORE="$USER_HOME/.gitignore_global"
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
echo "══════════════════════════════════════════════════════════════════════"
echo "🎉 ¡Instalación completada exitosamente!"
echo "══════════════════════════════════════════════════════════════════════"
if [ "$MODE" = "claude" ]; then
  echo "En tu terminal de Claude Code ($CLAUDE_TARGET_DIR) tienes disponible:"
  echo "  • /epic   -> Planificar y refinar la épica (.pipeline/ROADMAP.md)"
  echo "  • /plan   -> Crear el plan técnico de la tarea (.pipeline/01-PLAN.md)"
  echo "  • /auto   -> Modo 100% automático (Plan + pipeline-run loop + Close)"
  echo "  • /code   -> Implementar el plan y generar handoff (.pipeline/02-HANDOFF.md)"
  echo "  • /fix    -> Corregir observaciones de QA"
  echo "  • /qa     -> Auditar el git diff en modo ahorro de tokens"
  echo "  • /close  -> Cierre, actualización de roadmap y wiki"
else
  echo "Modo Multi-Agente activo con todos los harnesses configurados."
fi
echo ""
