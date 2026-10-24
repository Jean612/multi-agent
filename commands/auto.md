---
description: "Modo 100% Automático (Opción B): Crea .pipeline/01-PLAN.md, pregunta qué agentes usar como coder y QA, ejecuta pipeline-run loop por CLI y cierra la tarea con pipeline-close"
---

Activa y sigue las instrucciones de la skill `pipeline-auto`:
1. **Paso 0 (Telemetría Temprana):** Escribe inmediatamente `.pipeline/runtime.json` con `{"running":true,"action":"plan","step":"plan","iteration":1,"task":"...","updatedAt":"..."}` antes de explorar el código.
2. **Paso 1 (Elegir agentes):** Si `$ARGUMENTS` ya trae `--coder <agente>` y `--qa <agente>`, úsalos. Si no, **pregúntale al usuario antes de seguir** qué agente usar como **coder** (code/fix) y cuál como **QA**, entre `opencode`, `kimi`, `claude` y `gemini`. Sugiere por defecto `opencode` + `kimi`. Si el coder y el QA son el mismo agente, avisa que la auditoría pierde independencia.
3. **Paso 2 (Plan):** Si existe `.pipeline/ROADMAP.md`, selecciona la siguiente tarea pendiente (`[ ] TASK-XX`) o la indicada en `$ARGUMENTS`. Investiga el repositorio y genera `.pipeline/01-PLAN.md` siguiendo la plantilla de `pipeline-plan`.
4. **Paso 3 (Bucle Automático CLI):** Ejecuta en terminal `pipeline-run loop . --max-retries 3 --coder <coder> --qa <qa>` (o `node ~/.local/bin/pipeline-run loop . ...`). Si QA falla por cuota, reintenta con el coder; usa `--qa-fallback <agente|none>` para cambiarlo.
5. **Paso 4 (Cierre y Resumen Ejecutivo):** Cuando el loop apruebe (`APPROVED`), ejecuta `pipeline-close` (actualiza `.pipeline/ROADMAP.md` con `[x]`, exporta a la Wiki si está configurada, realiza commit con trailers `Co-Authored-By:` **de los agentes que realmente participaron** y archiva en `.pipeline/archive/`), y entrega la ficha de **Resumen Ejecutivo del Pipeline** firmada al final.
$ARGUMENTS
