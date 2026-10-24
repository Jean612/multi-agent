---
name: plan
description: "Comando /plan del Pipeline Multi-Agente — Fase 1: Investiga el repositorio y genera .pipeline/01-PLAN.md para la siguiente tarea del roadmap o requerimiento"
disable-model-invocation: true
---

<!-- Generado por scripts/sync-agent-commands.mjs desde commands/plan.md. No editar a mano. -->

Activa y sigue las instrucciones de la skill `pipeline-plan`.
1. Si existe `.pipeline/ROADMAP.md`, toma la siguiente tarea pendiente o la indicada en los argumentos del comando.
2. Investiga el código del repositorio a fondo.
3. Genera `.pipeline/01-PLAN.md` con rutas exactas, pasos detallados, comandos de verificación y checklist para QA.
**Argumentos:** usa el texto que el usuario escribió después de `/plan`, si lo hay.
