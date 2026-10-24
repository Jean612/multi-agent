---
name: pipeline-auto
description: 'Opción B del Pipeline Multi-Agente (Orquestador 100% Automático): Genera .pipeline/01-PLAN.md, pregunta agente y modelo para coder y QA (OpenCode, Kimi Code, Claude Code, Gemini CLI o Antigravity), ejecuta pipeline-run loop y cierra con pipeline-close + wiki-export.'
---

# Skill: `pipeline-auto` (Orquestador automático — Opción B)

Actúas como **Orquestador del flujo Multi-Agente headless**. Tu única interacción con los agentes es a través del CLI `pipeline-run`, que invoca de forma no interactiva al **coder** (implementación/corrección) y al **QA** (auditoría) que elija el usuario. Por defecto son OpenCode y Kimi Code.

## Flujo de Trabajo

### Paso 0 — Telemetría Temprana (Segundo Cero)
1. Antes de explorar o redactar el plan, escribe o actualiza `.pipeline/runtime.json`:
   ```json
   {
     "running": true,
     "action": "plan",
     "step": "plan",
     "iteration": 1,
     "task": "<Nombre de la tarea o TASK-XX>",
     "updatedAt": "<ISO-timestamp>"
   }
   ```
   Esto activa en la GUI el avatar del Cerebro y el banner iluminado mientras investigas el repo.

### Paso 0.5 — Elegir agentes y modelos (antes del plan)
1. Si los argumentos o el pedido ya indican agente y modelo de cada rol, en lenguaje natural o con flags, tradúcelos a `--coder`, `--coder-model`, `--qa` y `--qa-model` sin volver a preguntar.
2. Si falta algo, **pregúntalo antes del plan**: primero el agente de cada rol y después el modelo. Ofrece los alias de `pipeline-run models` (o `pipeline-run models --json`):
   - **Coder** (`code` y `fix`): `opencode` (default) | `kimi` | `claude` | `gemini` | `antigravity`.
   - **QA** (`qa`): `kimi` (default) | `opencode` | `claude` | `gemini` | `antigravity`.
   - **Kimi no lleva pregunta de modelo**: siempre usa `kimi-code/k3`.

   | Pedido | Flags |
   |---|---|
   | Claude Sonnet 5.5 para code | `--coder claude --coder-model sonnet` |
   | Haiku 5.5 para QA | `--qa claude --qa-model haiku` |
   | Kimi Code 3 para code | `--coder kimi` |
   | OpenCode GLM para QA | `--qa opencode --qa-model glm` |
   | Antigravity Argon (high) para code | `--coder antigravity --coder-model "argon high"` |
   | Gemini 3.8 Flash vía Antigravity para QA | `--qa antigravity --qa-model flash` |
3. Si coder y QA son el mismo agente, avísale que la auditoría pierde independencia y que no habrá fallback de QA, aunque los modelos sean distintos.
4. **Fallback de QA:** si el QA falla (cuota, crash), `pipeline-run` reintenta con el **coder** (si es distinto). Para cambiarlo usa `--qa-fallback <agente>` y `--qa-fallback-model <modelo>`; para desactivarlo, `--qa-fallback none`. Si el agente de fallback también está bloqueado, pregunta al usuario si lo desactiva.
5. Todos los agentes corren en modo autónomo sin preguntas (`opencode run --auto`, `kimi --auto`, `claude -p --permission-mode bypassPermissions`, `gemini --approval-mode yolo`, `agy -p --dangerously-skip-permissions`). Necesitan tener disponibles las skills `pipeline-code` y `qa` (las enlaza `install.sh`).
6. El **plan y el cierre** los hace siempre la sesión donde se lanzó `/auto`: Claude Code, Antigravity IDE o `agy`. Al terminar el loop, el control vuelve ahí para `pipeline-close`.

### Paso 1 — Plan (Cerebro)
1. Genera `.pipeline/01-PLAN.md` del proyecto destino siguiendo la skill `pipeline-plan`.
2. El plan debe tener `STATUS: READY_FOR_CODE` en su cabecera; sin plan, `pipeline-run` aborta con `status: NO_PLAN`.

### Paso 2 — Ejecución automática (Coder + QA por CLI)
1. Ejecuta en el directorio del proyecto:
   ```bash
   pipeline-run loop . --max-retries 3 --coder <coder> --coder-model <modelo> --qa <qa> --qa-model <modelo>
   ```
   (Omite `--coder-model` para Kimi. Si no está en PATH usa `node bin/pipeline-run.mjs loop . ...`. Los binarios se resuelven con `OPENCODE_BIN`, `KIMI_BIN`, `CLAUDE_BIN`, `GEMINI_BIN` y `AGY_BIN`; `claude` y `gemini` también se buscan en el PATH. `--qa-model` se aplica a cualquier agente de QA.)
2. Comportamiento del bucle (`bin/pipeline-run.mjs`):
   - Sin `.pipeline/02-HANDOFF.md` → corre el paso `code` con el coder elegido (`'Activa la skill pipeline-code...'`).
   - Sin `.pipeline/03-QA-REPORT.md`, o `02-HANDOFF.md` modificado después del QA → corre el paso `qa` con el QA elegido (`'Activa la skill qa...'`), con fallback al coder si falla.
   - Con `STATUS: CHANGES_REQUIRED` y reintentos disponibles → corre `fix` (el coder en modo corrección) y vuelve a `qa`.
   - Con `STATUS: APPROVED` → termina con exit code 0. Si agota `--max-retries` sin aprobar, salida `status: MAX_RETRIES_EXCEEDED` y exit code 1.
3. Monitorea la salida por consola (cada paso imprime `▶ <step> · <agente>/<modelo> (iter N) exit <code>`) o usa `--json` para consumir el resultado programáticamente.
4. Los logs de cada subproceso quedan en `.pipeline/logs/<timestamp>-<step>.log`.
5. Para inspección sin gasto de cuota: `pipeline-run loop . --dry-run --json` simula los pasos sin ejecutar agentes reales.

### Paso 3 — Cierre y Resumen Ejecutivo Obligatorio (Cerebro)
1. Si `pipeline-run` terminó en `APPROVED`, ejecuta la skill `pipeline-close` para el visto bueno arquitectónico final, commit firmado con `Co-Authored-By:` de los agentes y modelos participantes, actualización de `.pipeline/ROADMAP.md` (si existe), exportación unificada a la wiki y archivado en `.pipeline/archive/`.
2. **OBLIGATORIO — Entregar siempre al usuario un Resumen Ejecutivo estructurado y visual:**
   Al terminar, NO digas solo "quedó listo". Debes renderizar esta ficha resumen:

   ```markdown
   ### 📋 Resumen Ejecutivo del Pipeline
   - **Tarea:** <Nombre de la tarea o TASK-XX>
   - **Iteraciones:** <N iteraciones (ej. 1 intento directo / 2 intentos con fix de QA)>
   - **Archivos creados o modificados:**
     - `ruta/archivo1.ext` — <resumen de 1 línea de lo que se le hizo>
     - `ruta/archivo2.ext` — <resumen de 1 línea>
   - **Resultado de Tests:** ✅ <ej. 9/9 tests pasando (npm test)>
   - **Agentes:** Coder <agente>/<modelo> · QA <agente>/<modelo> (<fallback usado, si lo hubo>)
   - **Auditoría de QA:** ✅ APPROVED por <agente y modelo de QA que emitió el reporte>
   - **Archivado local:** `.pipeline/archive/<carpeta-archivada>/`
   - **Wiki:** ✅ Nota atómica generada y sincronizada (si aplica)
   - **Roadmap:** <Tareas restantes si existe ROADMAP.md o 'Listo para continuar'>

   ---
   *Firmado por: **<Agente (modelo) de la sesión orquestadora>** — Orquestador Multi-Agente*
   ```

## Reglas importantes
- Nunca edites manualmente `02-HANDOFF.md` ni `03-QA-REPORT.md`: son territorio del coder y del QA.
- Si el bucle termina en `MAX_RETRIES_EXCEEDED`, revisa `.pipeline/03-QA-REPORT.md` y decide: subir `--max-retries`, o intervenir manualmente con `/fix` interactivo antes de re-lanzar el bucle.
- Si el bucle termina en `STALLED`, lee el `Motivo`: binario no encontrado (`*_BIN`), agente desconocido, un paso que falló (cuota agotada del coder: relanza con otro `--coder`) o un reporte de QA sin `STATUS:` válido.
- En el commit de cierre, los `Co-Authored-By:` deben incluir agente y modelo de quienes realmente participaron; el historial de `pipeline-run` indica ambos datos para cada paso.
