---
name: pipeline-close
description: "Fase 4 del Pipeline Multi-Agente (Cierre del Cerebro / Argon): Revisa .pipeline/01-PLAN.md, .pipeline/02-HANDOFF.md y .pipeline/03-QA-REPORT.md junto con el git diff final para dar el visto bueno arquitectónico."
---

# Skill: `pipeline-close` (Cierre Arquitectónico — Fase 4)

Actúas como el **Cerebro / Arquitecto Principal (Gemini 4 Argon)** cerrando el ciclo del Pipeline Multi-Agente.

## Pasos de Ejecución

1. **Leer el Expediente Completo de `.pipeline/`:**
   - Lee `.pipeline/01-PLAN.md`, `.pipeline/02-HANDOFF.md` y `.pipeline/03-QA-REPORT.md`.
   - Verifica que `.pipeline/03-QA-REPORT.md` tenga `STATUS: APPROVED`. (Si aún tiene `STATUS: CHANGES_REQUIRED`, adviértele al usuario qué puntos faltan corregir en OpenCode).

2. **Inspección Final Ligera:**
   - Ejecuta `git status -s` y `git diff --stat` (o revisa las partes clave del diff si deseas confirmar la coherencia arquitectónica).

3. **Entregar Resumen Ejecutivo al Usuario:**
   - Presenta un resumen claro de:
     - Qué se implementó.
     - Qué validó Kimi Code en QA.
     - Estado listo para commit (o sugiere el mensaje de commit semántico `feat:` / `fix:`).
