---
name: code
description: "Comando /code del Pipeline Multi-Agente — Fase 2: Implementa el plan de .pipeline/01-PLAN.md, ejecuta tests y genera .pipeline/02-HANDOFF.md"
disable-model-invocation: true
---

<!-- Generado por scripts/sync-agent-commands.mjs desde commands/code.md. No editar a mano. -->

Activa y sigue las instrucciones de la skill `pipeline-code`.
1. Lee `.pipeline/01-PLAN.md` (y `.pipeline/03-QA-REPORT.md` si existe).
2. Implementa todos los cambios solicitados en el plan.
3. Ejecuta los comandos de verificación del plan e itera hasta que pasen sin errores.
4. Escribe el resumen técnico en `.pipeline/02-HANDOFF.md`.
**Argumentos:** usa el texto que el usuario escribió después de `/code`, si lo hay.
