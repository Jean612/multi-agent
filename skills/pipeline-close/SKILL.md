---
name: pipeline-close
description: "Fase 4 del Pipeline Multi-Agente (Cierre del Cerebro / Argon + Wiki Export Unificado): Revisa .pipeline/01-PLAN.md, .pipeline/02-HANDOFF.md y .pipeline/03-QA-REPORT.md junto con el git diff final, da el visto bueno arquitectónico y exporta en un solo paso las notas atómicas de los 3 agentes a la Wiki."
---

# Skill: `pipeline-close` (Cierre Arquitectónico + Wiki Export Unificado — Fase 4)

Actúas como el **Cerebro / Arquitecto Principal (Gemini 4 Argon)** cerrando el ciclo del Pipeline Multi-Agente y consolidando el conocimiento de los **3 agentes** en la Wiki personal sin que el usuario tenga que correr `wiki-export` en cada ventana.

## Pasos de Ejecución

1. **Leer el Expediente Completo de `.pipeline/` (Consolidación de los 3 Agentes):**
   - Lee `.pipeline/01-PLAN.md` (decisiones de arquitectura de Argon).
   - Lee `.pipeline/02-HANDOFF.md` (implementación, iteraciones y descubrimientos técnicos de OpenCode).
   - Lee `.pipeline/03-QA-REPORT.md` (auditoría, casos borde y hallazgos de Kimi Code QA).
   - Verifica que `.pipeline/03-QA-REPORT.md` tenga `STATUS: APPROVED`. (Si aún tiene `STATUS: CHANGES_REQUIRED`, adviértele al usuario qué puntos faltan corregir en OpenCode antes de cerrar).

2. **Inspección Final y Commit (Si aplica):**
   - Ejecuta `git status -s` y `git diff --stat` para confirmar la coherencia arquitectónica.

3. **Exportación Unificada a la Wiki (`wiki-export` de los 3 Agentes):**
   - Lee y sigue las instrucciones de la skill `wiki-export` (`~/.gemini/config/skills/wiki-export/SKILL.md` o `~/.agents/skills/wiki-export/SKILL.md` si está instalada).
   - En lugar de resumir solo este chat, **sintetiza el trabajo combinado de los 3 agentes** (usando `01-PLAN.md`, `02-HANDOFF.md`, `03-QA-REPORT.md` y el `git diff`):
     - Qué se diseñó (Argon).
     - Qué se implementó y qué quirks o problemas técnicos se resolvieron al codear (OpenCode).
     - Qué casos borde o bugs se atraparon y corrigieron en auditoría (Kimi Code).
   - Crea la(s) nota(s) atómica(s) en `$DATA_DIR/atomic/`, valida con `cli.py check`, actualiza `synthesis/` e `index`, y sincroniza con `cli.py sync push`.

4. **Actualizar el ROADMAP (si existe) y Archivar en `.pipeline/archive/`:**
   - Si existe `.pipeline/ROADMAP.md`, busca la tarea que se acaba de cerrar (ej. `TASK-01`) y márcala como completada: cambia `### [ ] TASK-XX` por `### [x] TASK-XX (Completada: YYYY-MM-DD HH:mm)`.
   - Una vez hecho el commit y exportada la nota a la Wiki, mueve `.pipeline/01-PLAN.md`, `.pipeline/02-HANDOFF.md` y `.pipeline/03-QA-REPORT.md` a `.pipeline/archive/YYYYMMDD-HHMM_<slug-tarea>/` (nunca uses `rm`). Así el historial local queda guardado por tarea y `.pipeline/` queda limpio para el siguiente flujo.

5. **Entregar Resumen Ejecutivo al Usuario:**
   - Presenta el resumen final de lo implementado, lo validado por Kimi, la ruta archivada en `.pipeline/archive/`, los enlaces a las notas atómicas creadas en la Wiki y el estado del Roadmap (cuántas tareas quedan pendientes y cuál es la siguiente).
