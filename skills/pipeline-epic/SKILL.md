---
name: pipeline-epic
description: "Fase 0 del Pipeline Multi-Agente (Refinamiento y Roadmap de Épica): Analiza la idea, tecnologías y viabilidad, y genera .pipeline/ROADMAP.md dividiendo la épica en tarjetas/tareas atómicas (TASK-01, TASK-02, ...) listas para ejecutarse una a una a lo largo de días con pipeline-plan o pipeline-auto sin quemar tokens."
---

# Skill: `pipeline-epic` (Refinamiento, Épica y Roadmap — Fase 0)

Actúas como el **Product Owner y Lead Architect (Gemini / Antigravity)** en la etapa previa al desarrollo.

## Objetivo
Transformar una idea grande, proyecto o requerimiento complejo en un **Roadmap de Tareas Atómicas** guardado en `.pipeline/ROADMAP.md`. Esto permite:
1. Dividir una aplicación completa en tarjetas independientes y secuenciales (`TASK-01`, `TASK-02`, etc.).
2. Trabajar durante días o semanas sin que se agoten los tokens en una sola mega-sesión.
3. Permitir que `pipeline-plan` y `pipeline-auto` tomen una tarea a la vez sin perder el contexto global.

---

## Pasos de Ejecución

1. **Conversación y Refinamiento Inicial:**
   - Analiza la visión del usuario, las opciones técnicas, trade-offs de arquitectura y viabilidad.
   - Si faltan detalles (librerías preferidas, dependencias, contratos de datos), acláralos con el usuario antes de congelar el backlog.

2. **Diseñar el Backlog Atómico:**
   - Divide el desarrollo en tareas pequeñas que puedan codearse y auditarse en **un solo ciclo de pipeline** (máximo 2 a 4 archivos tocados por tarea).
   - Ordena las tareas por dependencias lógicas:
     - Tareas base (modelos, tipos, configuración, esqueletos).
     - Tareas de lógica de negocio o servicios.
     - Tareas de UI o CLI.
     - Tareas de integración final y tests E2E.

3. **Crear o Actualizar `.pipeline/ROADMAP.md`:**
   - Asegúrate de que exista la carpeta `.pipeline/` en el proyecto.
   - Escribe `.pipeline/ROADMAP.md` siguiendo estrictamente esta estructura:

```markdown
# Roadmap de Épica: <Título de la Épica / Proyecto>

- **Fecha de Creación:** <YYYY-MM-DD>
- **Estado General:** IN_PROGRESS
- **Stack Tecnológico:** <Lenguaje, framework, librerías clave>

## 1. Visión y Arquitectura General
<Resumen de alto nivel: qué hace el sistema y cómo se estructuran sus capas.>

## 2. Convenciones y Reglas del Proyecto
- <Convención 1: ej. 100% TypeScript estricto, ESM nativo>
- <Convención 2: linter / test runner>

## 3. Backlog de Tareas

### [ ] TASK-01: <Título corto de la tarea>
- **Objetivo:** <Qué debe implementar esta tarea específica>
- **Alcance / Archivos Clave:** `src/types/...`, `src/core/...`
- **Criterios de Aceptación:**
  - [ ] <Criterio funcional 1>
  - [ ] <Comando de verificación: npm test / build>
- **Dependencias:** Ninguna (primer paso)

### [ ] TASK-02: <Título corto de la tarea>
- **Objetivo:** <...>
- **Alcance / Archivos Clave:** <...>
- **Criterios de Aceptación:**
  - [ ] <...>
- **Dependencias:** TASK-01

### [ ] TASK-03: <Título corto de la tarea>
- **Objetivo:** <...>
- **Alcance / Archivos Clave:** <...>
- **Criterios de Aceptación:**
  - [ ] <...>
- **Dependencias:** TASK-02

## 4. Historial de Progreso
- (Las tareas completadas se marcarán con [x] y registrarán su fecha aquí al ejecutarse pipeline-close).
```

4. **Instrucción de Continuación para el Usuario:**
   - Muestra el resumen del roadmap con la cantidad total de tareas y sugiere arrancar:
     > *"Roadmap creado en `.pipeline/ROADMAP.md` con X tareas. Cuando quieras empezar a construir, dile a Antigravity: `Inicia la TASK-01 con pipeline-plan` (o `pipeline-auto TASK-01`)."*
