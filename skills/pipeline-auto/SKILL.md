---
name: pipeline-auto
description: 'Opción B del Pipeline Multi-Agente (Orquestador 100% Automático): Genera .pipeline/01-PLAN.md, pregunta qué agentes usar como coder y QA (OpenCode, Kimi Code, Claude Code o Gemini CLI), ejecuta pipeline-run loop para que iteren solos por CLI, y cierra con pipeline-close + wiki-export.'
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
   Esto activa en la GUI el avatar de Argon y el banner iluminado mientras investigas el repo.

### Paso 0.5 — Elegir los agentes (antes del plan)
1. Si los argumentos ya traen `--coder <agente>` y `--qa <agente>`, úsalos sin preguntar.
2. Si no, **pregúntale al usuario** (en Claude Code con la herramienta de preguntas; en otros hosts, en el chat) qué agente usar en cada rol:
   - **Coder** (`code` y `fix`): `opencode` (default) | `kimi` | `claude` | `gemini`.
   - **QA** (`qa`): `kimi` (default) | `opencode` | `claude` | `gemini`.
   - Útil cuando un agente está bloqueado por cuota: por ejemplo, con OpenCode agotado → coder `kimi` o `claude`.
3. Si coder y QA son el mismo agente, avísale que la auditoría pierde independencia y que no habrá fallback de QA.
4. **Fallback de QA:** si el QA falla (cuota, crash), `pipeline-run` reintenta con el **coder** (si es distinto). Para cambiarlo usa `--qa-fallback <agente>`, y para desactivarlo `--qa-fallback none`. Si el agente de fallback también está bloqueado, pregunta al usuario si lo desactiva.
5. Todos los agentes corren en modo autónomo sin preguntas (`opencode run --auto`, `kimi --auto`, `claude -p --permission-mode bypassPermissions`, `gemini --approval-mode yolo`). Necesitan tener disponibles las skills `pipeline-code` y `qa` (las enlaza `install.sh`).

### Paso 1 — Plan (Cerebro / Argon)
1. Genera `.pipeline/01-PLAN.md` del proyecto destino siguiendo la skill `pipeline-plan`.
2. El plan debe tener `STATUS: READY_FOR_CODE` en su cabecera; sin plan, `pipeline-run` aborta con `status: NO_PLAN`.

### Paso 2 — Ejecución automática (Coder + QA por CLI)
1. Ejecuta en el directorio del proyecto:
   ```bash
   pipeline-run loop . --max-retries 3 --coder <coder> --qa <qa>
   ```
   (Si no está en PATH usa `node bin/pipeline-run.mjs loop . ...`. Los binarios se resuelven con `OPENCODE_BIN`, `KIMI_BIN`, `CLAUDE_BIN` y `GEMINI_BIN`; `claude` y `gemini` también se buscan en el PATH. Opcionales: `--coder-model <m>` y `--qa-model <m>`, este último solo para OpenCode como QA.)
2. Comportamiento del bucle (`bin/pipeline-run.mjs`):
   - Sin `.pipeline/02-HANDOFF.md` → corre el paso `code` con el coder elegido (`'Activa la skill pipeline-code...'`).
   - Sin `.pipeline/03-QA-REPORT.md`, o `02-HANDOFF.md` modificado después del QA → corre el paso `qa` con el QA elegido (`'Activa la skill qa...'`), con fallback al coder si falla.
   - Con `STATUS: CHANGES_REQUIRED` y reintentos disponibles → corre `fix` (el coder en modo corrección) y vuelve a `qa`.
   - Con `STATUS: APPROVED` → termina con exit code 0. Si agota `--max-retries` sin aprobar, salida `status: MAX_RETRIES_EXCEEDED` y exit code 1.
3. Monitorea la salida por consola (cada paso imprime `▶ <step> · <agente> (iter N) exit <code>`) o usa `--json` para consumir el resultado programáticamente.
4. Los logs de cada subproceso quedan en `.pipeline/logs/<timestamp>-<step>.log`.
5. Para inspección sin gasto de cuota: `pipeline-run loop . --dry-run --json` simula los pasos sin ejecutar agentes reales.

### Paso 3 — Cierre y Resumen Ejecutivo Obligatorio (Cerebro / Argon)
1. Si `pipeline-run` terminó en `APPROVED`, ejecuta la skill `pipeline-close` para el visto bueno arquitectónico final, commit firmado con `Co-Authored-By:` de los agentes participantes, actualización de `.pipeline/ROADMAP.md` (si existe), exportación unificada a la wiki y archivado en `.pipeline/archive/`.
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
   - **Agentes:** Coder <agente> · QA <agente> (<fallback usado, si lo hubo>)
   - **Auditoría de QA:** ✅ APPROVED por <agente de QA que emitió el reporte>
   - **Archivado local:** `.pipeline/archive/<carpeta-archivada>/`
   - **Wiki:** ✅ Nota atómica generada y sincronizada (si aplica)
   - **Roadmap:** <Tareas restantes si existe ROADMAP.md o 'Listo para continuar'>

   ---
   *Firmado por: **Antigravity (Gemini 4 Argon)** — Orquestador Multi-Agente*
   ```

## Reglas importantes
- Nunca edites manualmente `02-HANDOFF.md` ni `03-QA-REPORT.md`: son territorio del coder y del QA.
- Si el bucle termina en `MAX_RETRIES_EXCEEDED`, revisa `.pipeline/03-QA-REPORT.md` y decide: subir `--max-retries`, o intervenir manualmente con `/fix` interactivo antes de re-lanzar el bucle.
- Si el bucle termina en `STALLED`, lee el `Motivo`: binario no encontrado (`*_BIN`), agente desconocido, un paso que falló (cuota agotada del coder: relanza con otro `--coder`) o un reporte de QA sin `STATUS:` válido.
- En el commit de cierre, los `Co-Authored-By:` deben ser los de los agentes que realmente participaron (el historial de `pipeline-run` indica qué agente corrió cada paso).
