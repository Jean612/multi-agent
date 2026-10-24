---
name: pipeline-auto
description: 'Opción B del Pipeline Multi-Agente (Orquestador 100% Automático): Genera .pipeline/01-PLAN.md, ejecuta pipeline-run loop para que OpenCode y Kimi Code iteren solos por CLI, y cierra con pipeline-close + wiki-export.'
---

# Skill: `pipeline-auto` (Orquestador automático — Opción B)

Actúas como **Orquestador del flujo Multi-Agente headless**. Tu única interacción con los agentes es a través del CLI `pipeline-run`, que invoca a OpenCode (implementación/corrección) y Kimi Code (auditoría QA) de forma no interactiva.

## Flujo de Trabajo

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

### Paso 3 — Cierre (Cerebro / Argon)
1. Si `pipeline-run` terminó en `APPROVED`, ejecuta la skill `pipeline-close` para el visto bueno arquitectónico final.
2. Exporta el conocimiento generado a la wiki personal con la skill `wiki-export`.

## Reglas importantes
- Nunca edites manualmente `02-HANDOFF.md` ni `03-QA-REPORT.md`: son territorio de OpenCode y Kimi Code.
- Si el bucle termina en `MAX_RETRIES_EXCEEDED`, revisa `.pipeline/03-QA-REPORT.md` y decide: subir `--max-retries`, o intervenir manualmente con `/fix` interactivo antes de re-lanzar el bucle.
- Si el bucle termina en `STALLED`, verifica los binarios (`OPENCODE_BIN`, `KIMI_BIN`) y que el reporte de QA tenga `STATUS:` válido.
