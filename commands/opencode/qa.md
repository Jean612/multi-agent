---
description: "Audita el git diff contra .pipeline/01-PLAN.md y .pipeline/02-HANDOFF.md en modo ahorro de tokens y genera .pipeline/03-QA-REPORT.md"
---

Activa y sigue las instrucciones de la skill `qa` (ideal para correr con modelos analíticos como DeepSeek o Mimo si Kimi agotó su cuota):
1. Lee únicamente `.pipeline/01-PLAN.md` y `.pipeline/02-HANDOFF.md`.
2. Ejecuta `git status -s` y `git diff` para revisar exclusivamente el código modificado o añadido.
3. Evalúa cumplimiento del plan, bugs lógicos, edge cases, seguridad y regresiones.
4. Escribe `.pipeline/03-QA-REPORT.md` comenzando estrictamente con `STATUS: APPROVED` o `STATUS: CHANGES_REQUIRED`.
$ARGUMENTS
