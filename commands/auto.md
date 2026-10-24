---
description: "Modo 100% Automático (Opción B): Crea .pipeline/01-PLAN.md, ejecuta pipeline-run loop por CLI (OpenCode + Kimi QA) y cierra la tarea con pipeline-close"
---

Activa y sigue las instrucciones de la skill `pipeline-auto`:
1. **Paso 0 (Telemetría Temprana):** Escribe inmediatamente `.pipeline/runtime.json` con `{"running":true,"action":"plan","step":"plan","iteration":1,"task":"...","updatedAt":"..."}` antes de explorar el código.
2. **Paso 1 (Plan):** Si existe `.pipeline/ROADMAP.md`, selecciona la siguiente tarea pendiente (`[ ] TASK-XX`) o la indicada en `$ARGUMENTS`. Investiga el repositorio y genera `.pipeline/01-PLAN.md` siguiendo la plantilla de `pipeline-plan`.
3. **Paso 2 (Bucle Automático CLI):** Ejecuta en terminal `pipeline-run loop . --max-retries 3` (o `node ~/.local/bin/pipeline-run loop . --max-retries 3`) para que OpenCode implemente/corrija y Kimi Code (o su fallback en OpenCode) audite hasta obtener `STATUS: APPROVED`.
4. **Paso 3 (Cierre y Resumen Ejecutivo):** Cuando el loop apruebe (`APPROVED`), ejecuta `pipeline-close` (actualiza `.pipeline/ROADMAP.md` con `[x]`, exporta a la Wiki si está configurada, realiza commit con trailers `Co-Authored-By:` y archiva en `.pipeline/archive/`), y entrega la ficha de **Resumen Ejecutivo del Pipeline** firmada al final.
$ARGUMENTS
