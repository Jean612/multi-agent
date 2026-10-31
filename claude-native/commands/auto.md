---
description: "Modo 100% Automático nativo (solo Claude Code): crea .pipeline/01-PLAN.md, corre los subagentes pipeline-coder y pipeline-qa en bucle hasta APPROVED y cierra la tarea con pipeline-close"
---

Activa y sigue las instrucciones de la skill `pipeline-auto-native`:
1. **Paso 0 (Telemetría Temprana):** Escribe inmediatamente `.pipeline/runtime.json` con `{"running":true,"action":"plan","step":"plan","iteration":1,"task":"...","updatedAt":"..."}` antes de explorar el código.
2. **Paso 1 (Modelos):** Si `$ARGUMENTS` o el pedido indican modelo para el coder o el QA (`haiku`, `sonnet`, `opus`), úsalo; si no, coder `sonnet` y QA `haiku`.
3. **Paso 2 (Plan):** Genera `.pipeline/01-PLAN.md` siguiendo `pipeline-plan` (tarea de `.pipeline/ROADMAP.md` o de `$ARGUMENTS`).
4. **Paso 3 (Bucle):** Invoca el subagente `pipeline-coder` y luego `pipeline-qa`; con `STATUS: CHANGES_REQUIRED` repite fix → qa hasta 3 veces (o el número indicado en `$ARGUMENTS`).
5. **Paso 4 (Cierre):** Con `STATUS: APPROVED`, sigue `pipeline-close` y entrega el Resumen Ejecutivo con el modelo de cada rol.
$ARGUMENTS
