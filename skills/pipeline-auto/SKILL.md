---
name: pipeline-auto
description: 'Opción B del Pipeline Multi-Agente (Orquestador 100% Automático): Genera .pipeline/01-PLAN.md, ejecuta pipeline-run loop para que OpenCode y Kimi Code iteren solos por CLI, y cierra con pipeline-close + wiki-export.'
---

# Skill: `pipeline-auto` (Orquestador automático — Opción B)

Actúas como **Orquestador del flujo Multi-Agente headless**. Tu única interacción con los agentes es a través del CLI `pipeline-run`, que invoca a OpenCode (implementación/corrección) y Kimi Code (auditoría QA) de forma no interactiva.

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

### Paso 1 — Plan (Cerebro / Argon)
1. Genera `.pipeline/01-PLAN.md` del proyecto destino siguiendo la skill `pipeline-plan`.
2. El plan debe tener `STATUS: READY_FOR_CODE` en su cabecera; sin plan, `pipeline-run` aborta con `status: NO_PLAN`.

### Paso 2 — Ejecución automática (Coder + QA por CLI)
1. Ejecuta en el directorio del proyecto:
   ```bash
   pipeline-run loop . --max-retries 3
   ```
   (Si no está en PATH usa `node bin/pipeline-run.mjs loop . --max-retries 3`; los binarios se resuelven con `OPENCODE_BIN` y `KIMI_BIN`).
2. Comportamiento del bucle (`bin/pipeline-run.mjs`):
   - Sin `.pipeline/02-HANDOFF.md` → corre el paso `code` (OpenCode `run --auto -c 'Activa la skill pipeline-code...'`).
   - Sin `.pipeline/03-QA-REPORT.md`, o `02-HANDOFF.md` modificado después del QA → corre el paso `qa` (Kimi `-p 'Activa la skill qa...' --auto -c`).
   - Con `STATUS: CHANGES_REQUIRED` y reintentos disponibles → corre `fix` (OpenCode en modo corrección) y vuelve a `qa`.
   - Con `STATUS: APPROVED` → termina con exit code 0. Si agota `--max-retries` sin aprobar, salida `status: MAX_RETRIES_EXCEEDED` y exit code 1.
3. Monitorea la salida por consola (cada paso imprime `▶ <step> (iter N) exit <code>`) o usa `--json` para consumir el resultado programáticamente.
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
   - **Auditoría de QA:** ✅ APPROVED por <Kimi Code / OpenCode DeepSeek>
   - **Archivado local:** `.pipeline/archive/<carpeta-archivada>/`
   - **Wiki:** ✅ Nota atómica generada y sincronizada (si aplica)
   - **Roadmap:** <Tareas restantes si existe ROADMAP.md o 'Listo para continuar'>

   ---
   *Firmado por: **Antigravity (Gemini 4 Argon)** — Orquestador Multi-Agente*
   ```

## Reglas importantes
- Nunca edites manualmente `02-HANDOFF.md` ni `03-QA-REPORT.md`: son territorio de OpenCode y Kimi Code.
- Si el bucle termina en `MAX_RETRIES_EXCEEDED`, revisa `.pipeline/03-QA-REPORT.md` y decide: subir `--max-retries`, o intervenir manualmente con `/fix` interactivo antes de re-lanzar el bucle.
- Si el bucle termina en `STALLED`, verifica los binarios (`OPENCODE_BIN`, `KIMI_BIN`) y que el reporte de QA tenga `STATUS:` válido.
