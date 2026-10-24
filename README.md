# 🛰️ Multi-Agent Coding Pipeline (`.pipeline/`)

Sistema ligero de orquestación y monitoreo en tiempo real para coordinar múltiples agentes de IA (o múltiples modelos dentro de un mismo agente) optimizando el consumo de tokens y cuota:

1. **🧠 El Cerebro (Planner & Reviewer Final — Antigravity Argon / Claude Sonnet-Opus):**
   Investiga el repositorio, diseña el roadmap de épicas (`.pipeline/ROADMAP.md`), escribe el plan técnico (`.pipeline/01-PLAN.md`) y cierra el ciclo archivando el expediente.
2. **⚡ El Obrero (Coder & Iterador — OpenCode `GLM 5.3 Flash Free` / Claude Haiku):**
   Implementa el plan, ejecuta la suite de tests e itera sin límite hasta que todo compile en verde, dejando el resumen en `.pipeline/02-HANDOFF.md`.
3. **🛡️ El Auditor Quirúrgico (QA — Kimi Code / Fallback DeepSeek / Claude Haiku):**
   Audita **únicamente** el `git diff` contra el plan original (ahorrando 70%–80% de cuota al no explorar el repositorio completo) y emite `.pipeline/03-QA-REPORT.md` (`STATUS: APPROVED` o `STATUS: CHANGES_REQUIRED`).

---

## 🚀 Instalación Rápida (macOS y Linux)

Clona el repositorio y ejecuta el instalador interactivo:

```bash
git clone git@github.com:Jean612/multi-agent.git
cd multi-agent
./install.sh
```

También soporta flags no interactivos:
```bash
# Modo 1: Multi-Agente Completo (Antigravity + OpenCode + Kimi Code + Claude Code)
./install.sh --mode multi

# Modo 2: Solo Claude Code (para entornos corporativos, soporta carpeta custom ej. ~/.claude-cf)
./install.sh --mode claude --claude-dir ~/.claude-cf
```

---

## 🛠️ Modos de Uso

### Opción A: Flujo Manual en Ventanas / Pestañas (`/epic`, `/plan`, `/code`, `/fix`, `/qa`, `/close`)
* **Fase 0 (Opcional):** `/epic` (o skill `pipeline-epic`) → Divide una idea grande en tareas `TASK-01`, `TASK-02` dentro de `.pipeline/ROADMAP.md`.
* **Fase 1:** `/plan` (`pipeline-plan`) → Genera `.pipeline/01-PLAN.md`.
* **Fase 2:** `/code` (`pipeline-code`) → Implementa, corre tests y genera `.pipeline/02-HANDOFF.md`. (Si QA pide cambios: `/fix`).
* **Fase 3:** `/qa` (`qa`) → Audita el `git diff` y escribe `.pipeline/03-QA-REPORT.md`.
* **Fase 4:** `/close` (`pipeline-close`) → Revisa el cierre, marca `[x] TASK-XX` en el roadmap y archiva en `.pipeline/archive/`.

### Opción B: Orquestador 100% Automático (`pipeline-auto` / `pipeline-run`)
Hablas únicamente con el Cerebro (Antigravity) usando la skill `pipeline-auto`, o ejecutas por CLI:
```bash
pipeline-run loop . --max-retries 3
```
*(Si Kimi Code agota su cuota, `pipeline-run` activa automáticamente el fallback de QA con OpenCode `deepseek-v4.1-flash-free`)*.

### Opción C: Mission Control GUI + Oficina Virtual "Pixel Agents" (`pipeline-ui`)
Levanta el monitor web en tiempo real (Server-Sent Events + File Watcher sobre `.pipeline/runtime.json`) con vista de 3 columnas y oficina animada estilo **Pixel Agents**:
```bash
pipeline-ui . --port 4173 --open
```

---

## 🧪 Tests

100% Node.js nativo (ESM), cero dependencias externas (`node_modules` ausente):
```bash
npm test
```

---

*Diseñado y construido con **Antigravity (Gemini 4 Argon)**, **OpenCode (GLM 5.3 Flash)** y **Kimi Code**.*
