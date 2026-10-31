---
name: pipeline-auto-native
description: 'Modo 2 del Pipeline Multi-Agente (solo Claude Code, sin pipeline-run): genera .pipeline/01-PLAN.md en esta sesión, ejecuta coder y QA como subagentes nativos (pipeline-coder y pipeline-qa) en bucle hasta APPROVED y cierra con pipeline-close.'
---

# Skill: `pipeline-auto-native` (Orquestador con subagentes — Modo 2)

Actúas como **Cerebro y Orquestador**. A diferencia de `pipeline-auto`, no lanzas procesos `claude -p` con `pipeline-run`: el coder y el QA son subagentes de esta misma sesión, invocados con la herramienta de agentes. Así heredan los permisos de la sesión, no hace falta `bypassPermissions` y no hay timeout de Bash que corte el bucle.

| Rol | Quién | Modelo por defecto |
|---|---|---|
| Cerebro (plan y cierre) | Esta sesión | El de la sesión |
| Coder (`code` / `fix`) | Subagente `pipeline-coder` | `sonnet` |
| QA | Subagente `pipeline-qa` | `haiku` |

## Paso 0 — Telemetría temprana
Antes de explorar el código, escribe `.pipeline/runtime.json` (crea `.pipeline/` si falta):
```json
{ "running": true, "action": "plan", "step": "plan", "iteration": 1, "task": "<tarea o TASK-XX>", "updatedAt": "<ISO-timestamp>" }
```

## Paso 1 — Modelos
- Si los argumentos o el pedido indican modelo para el coder o el QA (`haiku`, `sonnet` u `opus`), úsalo como `model` al invocar ese subagente. Si no, usa los modelos por defecto de la tabla y dilo en una línea; no preguntes.
- Coder y QA son siempre Claude: no hay fallback de QA a otro agente. Si el usuario pide el mismo modelo para ambos, avísale que la auditoría pierde independencia.

## Paso 2 — Plan (Cerebro)
1. Si existe `.pipeline/ROADMAP.md`, toma la tarea pendiente (`[ ] TASK-XX`) o la indicada en los argumentos.
2. Sigue la skill `pipeline-plan` y genera `.pipeline/01-PLAN.md` con `STATUS: READY_FOR_CODE`.
3. Si quedaron `02-HANDOFF.md` o `03-QA-REPORT.md` de una tarea anterior, archívalos en `.pipeline/archive/` antes de seguir (nunca con `rm`): el coder leería ese reporte como si fuera de esta tarea.

## Paso 3 — Bucle coder ↔ QA
`MAX_RETRIES` = 3, salvo que los argumentos digan otro número. Empieza con `iteración = 1`.

Antes de cada paso, actualiza `.pipeline/runtime.json` para que `pipeline-ui` y `pipeline-status` lo muestren:
```json
{ "running": true, "action": "loop", "step": "<code|qa|fix>", "iteration": <N>, "coder": "claude", "coderModel": "<modelo>", "qaEngine": "claude", "qaModel": "<modelo>", "updatedAt": "<ISO-timestamp>" }
```

1. **code** — Invoca el subagente `pipeline-coder`: *"Iteración 1: implementa `.pipeline/01-PLAN.md` y escribe `.pipeline/02-HANDOFF.md`."* Si al terminar no existe `02-HANDOFF.md`, detente con `STALLED`.
2. **qa** — Invoca el subagente `pipeline-qa`: *"Audita la iteración <N> y escribe `.pipeline/03-QA-REPORT.md`."* No le pases tu propia lectura del diff ni del handoff: el QA debe formarse su juicio. Lee la línea `STATUS:` del reporte:
   - `APPROVED` → ve al Paso 4.
   - `CHANGES_REQUIRED` con `iteración < MAX_RETRIES` → suma 1 a la iteración y sigue con **fix**.
   - `CHANGES_REQUIRED` con `iteración = MAX_RETRIES` → detente con `MAX_RETRIES_EXCEEDED`.
   - Sin reporte o sin `STATUS:` válido → detente con `STALLED`.
3. **fix** — Invoca `pipeline-coder`: *"Iteración <N>: corrige los hallazgos de `.pipeline/03-QA-REPORT.md` y actualiza `.pipeline/02-HANDOFF.md`."* Luego vuelve a **qa**.

Reglas del bucle:
- Invoca los subagentes de uno en uno y en primer plano: cada paso necesita el resultado del anterior.
- Durante el bucle no edites código ni `02-HANDOFF.md` / `03-QA-REPORT.md`: son del coder y del QA.
- Anota cada paso (iteración, paso, subagente, modelo) para el resumen y los `Co-Authored-By:`.
- Si te detienes con `STALLED` o `MAX_RETRIES_EXCEEDED`, escribe `runtime.json` con `"running": false` y `"status"`, muestra los hallazgos pendientes y pregunta al usuario si sube los reintentos, cambia de modelo o corrige a mano con `/fix`.

## Paso 4 — Cierre (Cerebro)
1. Escribe `runtime.json` con `"running": false` y `"status": "APPROVED"`.
2. Sigue la skill `pipeline-close`. En el commit, pon una línea `Co-Authored-By: Claude (<id del modelo>) <noreply@anthropic.com>` por cada modelo distinto que participó (los ids salen de las firmas de `01-PLAN.md`, `02-HANDOFF.md` y `03-QA-REPORT.md`).
3. Entrega el resumen ejecutivo:

```markdown
### 📋 Resumen Ejecutivo del Pipeline
- **Tarea:** <Nombre de la tarea o TASK-XX>
- **Iteraciones:** <N (ej. 1 intento directo / 2 intentos con fix de QA)>
- **Archivos creados o modificados:**
  - `ruta/archivo.ext` — <resumen de 1 línea>
- **Resultado de Tests:** ✅ <ej. 9/9 tests pasando (npm test)>
- **Agentes:** Cerebro Claude/<modelo> · Coder pipeline-coder/<modelo> · QA pipeline-qa/<modelo>
- **Auditoría de QA:** ✅ APPROVED en la iteración <N>
- **Archivado local:** `.pipeline/archive/<carpeta-archivada>/`
- **Wiki:** ✅ Nota atómica generada (si aplica)
- **Roadmap:** <Tareas restantes o 'Listo para continuar'>
```
