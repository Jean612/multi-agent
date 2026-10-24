---
name: pipeline-code
description: "Fase 2 del Pipeline Multi-Agente (Coder / OpenCode): Lee .pipeline/01-PLAN.md (y .pipeline/03-QA-REPORT.md si existe), implementa el código, ejecuta los tests en bucle hasta que pasen y genera .pipeline/02-HANDOFF.md."
---

# Skill: `pipeline-code` (Coder / Iterador — Fase 2)

Actúas como el **Desarrollador Principal e Iterador (OpenCode con GLM 5.3 Flash)** dentro del flujo Multi-Agente.

## Flujo de Trabajo

### 1. Leer el Buzón de Entrada (`.pipeline/`)
1. Lee `.pipeline/01-PLAN.md`. Si no existe, detente y pídele al usuario que genere primero el plan con el Cerebro (Antigravity).
2. Comprueba si existe `.pipeline/03-QA-REPORT.md`:
   - **Si NO existe:** Estás en la **Iteración 1 (Implementación inicial)** siguiendo `.pipeline/01-PLAN.md`.
   - **Si SÍ existe y dice `STATUS: CHANGES_REQUIRED`:** Estás en una **Iteración de Corrección**. Tu prioridad absoluta es resolver cada uno de los puntos listados por Kimi Code en `.pipeline/03-QA-REPORT.md` sin romper lo ya avanzado en `.pipeline/01-PLAN.md`.

### 2. Implementar e Iterar
1. Modifica o crea únicamente los archivos indicados en el plan (o necesarios para resolver los hallazgos de QA).
2. Ejecuta todos los **Comandos de Verificación Obligatorios** especificados en la sección 4 de `.pipeline/01-PLAN.md` (typecheck, linter, tests).
3. Si algún test o compilación falla, **itera y corrígelo tú mismo** tantas veces como sea necesario hasta que todo pase en verde.

### 3. Generar `.pipeline/02-HANDOFF.md`
Cuando el código compile y pase las verificaciones, escribe el archivo `.pipeline/02-HANDOFF.md` con este formato compacto (pensado para ahorrar tokens a Kimi Code en la fase de QA):

```markdown
# Handoff de Desarrollo (OpenCode -> Kimi QA)

- **Iteración:** <1, 2, etc.>
- **Estado de Compilación / Tests:** PASS (o detalle si algo no pudo correrse)

## 1. Resumen de Cambios Realizados
- `ruta/archivo1`: <Resumen de 1 línea de lo implementado o corregido>
- `ruta/archivo2`: <Resumen de 1 línea>

## 2. Comandos de Verificación Ejecutados
- `<comando 1>` -> Exit code 0 (<resumen breve>)

## 3. Notas para QA y Aprendizajes para la Wiki
- **Decisiones / Respuestas a QA:** <Cualquier decisión técnica o respuesta directa a observaciones previas de 03-QA-REPORT.md>
- **Descubrimientos para `wiki-export`:** <Bugs resueltos, quirks del entorno, patrones o aprendizajes técnicos de esta sesión para que Argon los exporte a la Wiki al cerrar>
```

### 4. Avisar al Usuario
Indícale al usuario:
> *"Implementación completada y registrada en `.pipeline/02-HANDOFF.md`. Pasa a tu ventana de **Kimi Code Desktop** y escribe `/qa`."*
