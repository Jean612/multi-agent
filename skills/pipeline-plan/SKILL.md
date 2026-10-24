---
name: pipeline-plan
description: "Fase 1 del Pipeline Multi-Agente (Cerebro): Investiga el repositorio a fondo y genera .pipeline/01-PLAN.md con rutas exactas, pasos detallados y criterios de QA para que el coder programe y el QA audite sin gastar cuota extra."
---

# Skill: `pipeline-plan` (Cerebro / Arquitecto — Fase 1)

Actúas como el **Cerebro / Arquitecto Principal** dentro del flujo Multi-Agente de 3 roles. Cada rol lo ocupa el agente y modelo que eligió el usuario (OpenCode, Kimi Code, Claude Code, Gemini o Antigravity):
1. **Cerebro (tú):** Investigas todo el contexto y creas `.pipeline/01-PLAN.md`. También haces el cierre (`/close`).
2. **Coder:** Lee tu plan, programa e itera hasta que pasen las verificaciones.
3. **QA:** Audita únicamente el `git diff` contra tu plan.

No nombres un agente concreto en el plan: escríbelo para "el coder" y "el QA", porque pueden cambiar entre tareas.

## Regla Principal
Tu trabajo es **ahorrarle búsqueda e incertidumbre** a los otros dos agentes. Como tú tienes la mejor capacidad de investigación y contexto, debes entregarles las rutas exactas de los archivos, las firmas de funciones/tipos relevantes y los comandos de verificación exactos.

## Pasos de Ejecución

0. **Telemetría Temprana en el Segundo Cero (`.pipeline/runtime.json`):**
   - Asegúrate de que exista la carpeta `.pipeline/`.
   - Apenas recibas la instrucción (ANTES de explorar archivos o pensar la arquitectura), escribe o actualiza `.pipeline/runtime.json`:
     ```json
     {
       "running": true,
       "action": "plan",
       "step": "plan",
       "iteration": 1,
       "task": "<Nombre de la tarea o TASK-XX>",
       "updatedAt": "<ISO-timestamp>"
     }
     ```
   - Esto hace que en la GUI / Pixel Agents el avatar del Cerebro se active de inmediato en modo diseño (`researching`), su escritorio flote y la Columna 1 se ilumine mientras investigas en el chat.

1. **Explorar e Investigar (y consultar ROADMAP si existe):**
   - Si existe `.pipeline/ROADMAP.md`, léelo para obtener el contexto de la épica y ubicar la tarea que toca:
     - Si el usuario dice "inicia la siguiente tarea" o no especifica número, selecciona la primera tarea pendiente (`### [ ] TASK-XX`).
     - Si el usuario indica una tarea puntual (ej. `TASK-02`), enfócate en ella.
   - Usa tus herramientas de búsqueda (`grep_search`, `find_by_name`, `read_file`) para entender la arquitectura actual del proyecto donde se solicita el cambio.
   - Si algún requisito del usuario es ambiguo, hazle las preguntas necesarias antes de escribir el plan.

2. **Preparar el Buzón `.pipeline/` (Archivado sin borrar historial):**
   - Asegúrate de que exista la carpeta `.pipeline/` en la raíz del proyecto actual.
   - Si existen archivos `01-PLAN.md`, `02-HANDOFF.md` o `03-QA-REPORT.md` de una tarea anterior y el usuario está pidiendo una tarea **nueva**, **NUNCA los borres con `rm`**: muévelos a `.pipeline/archive/YYYYMMDD-HHMM_<slug-tarea-anterior>/` para conservar el historial local intacto y dejar limpio `.pipeline/` para la tarea actual.

3. **Escribir `.pipeline/01-PLAN.md`:**
   - Crea el archivo `.pipeline/01-PLAN.md` siguiendo estrictamente esta estructura:

```markdown
# Plan de Implementación Multi-Agente

- **Tarea:** <Título corto de la funcionalidad o fix>
- **Fecha:** <YYYY-MM-DD HH:mm>
- **Estado:** READY_FOR_CODE

## 1. Contexto y Objetivo
<Explicación clara y concisa de qué se quiere lograr y por qué.>

## 2. Archivos Exactos a Crear o Modificar
- `ruta/relativa/archivo1.ts` (Modificar — <líneas aprox. o función>)
- `ruta/relativa/archivo2.ts` (Crear — <propósito>)

## 3. Diseño Técnico y Pasos de Implementación (Para el Coder)
### Paso 1: <Título>
- **Archivo:** `ruta/relativa/archivo1.ts`
- **Detalle:** <Instrucciones específicas, tipos, lógica e imports a considerar.>

### Paso 2: <Título>
- **Archivo:** `ruta/relativa/archivo2.ts`
- **Detalle:** <Instrucciones específicas.>

## 4. Comandos de Verificación Obligatorios (Para el Coder)
El coder DEBE ejecutar estos comandos antes de dar por terminada su fase:
- `<comando de typecheck / build, ej: npm run build o tsc --noEmit>`
- `<comando de tests / linter, ej: npm test>`

## 5. Criterios de Aceptación y Auditoría (Para el QA)
El QA revisará el `git diff` verificando:
- [ ] <Criterio funcional 1>
- [ ] <Criterio de casos borde / errores 2>
- [ ] <Criterio de seguridad / rendimiento / tipado 3>
- [ ] No se introdujeron archivos basura ni cambios fuera del alcance del plan.

---
*Firmado por: **<Agente (modelo)>** — Cerebro & Arquitecto Principal*
```

4. **Notificar al Usuario:**
   - Confirma que `.pipeline/01-PLAN.md` fue generado y dile:
     > *"Plan listo en `.pipeline/01-PLAN.md`. Siguiente paso: ejecuta `/code` en el agente que hará de coder, o lanza `/auto` para que el coder y el QA corran solos."*
