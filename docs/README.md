# Arquitectura Multi-Agente: Documentación de Planes (A, B y C)

Este directorio contiene la documentación técnica y los planes de implementación para orquestar tus tres agentes de IA optimizando el rendimiento y el consumo de cuota de cada uno:

## Roles del Equipo de Agentes

| Rol | Agente / Modelo | Cuota / Costo | Responsabilidad Principal | Binario Local Detectado |
| :--- | :--- | :--- | :--- | :--- |
| **1. Cerebro (Planner & Juez Final)** | **Antigravity (Gemini 4 Argon)** | Suscripción Google | Investigar el repositorio, diseñar la arquitectura, generar el plan exacto y dar el visto bueno final. | `~/.local/bin/agy` |
| **2. Coder (Fuerza Bruta & Iteración)** | **OpenCode (GLM 5.3 Flash Free)** | **Gratis / Ilimitado** | Escribir código, ejecutar pruebas, corregir errores de compilación e iterar todas las veces necesarias. | `~/.opencode/bin/opencode` |
| **3. QA (Auditor Quirúrgico)** | **Kimi Code** | **Plan Básico (Limitado)** | Auditar **únicamente** el `git diff` contra el plan original para detectar bugs, edge cases y fallos de seguridad sin gastar cuota explorando el repo. | `~/.kimi-code/bin/kimi` |

---

## Índice de Planes

1. **[Plan Opción A: 3 Ventanas Desktop + Buzón Compartido y Skills](./plan-opcion-a-skills-buzon-compartido.md)**
   * **Ideal para:** Mantener tus 3 aplicaciones de escritorio abiertas en pantalla, eliminando el copiar/pegar manual de prompts largos mediante archivos en `.pipeline/` y comandos cortos (`/plan`, `/code`, `/qa`).
2. **[Plan Opción B: Antigravity como Orquestador 100% Automático (CLI Headless)](./plan-opcion-b-orquestador-automatico-cli.md)**
   * **Ideal para:** Hablar únicamente con Antigravity y que él invoque en segundo plano a OpenCode y Kimi Code en bucle hasta que el código pase el control de calidad.
3. **[Plan Opción C: Interfaz Gráfica Propia (GUI "Mission Control")](./plan-opcion-c-interfaz-grafica-mission-control.md)**
   * **Ideal para:** Tener un Dashboard visual propio (web local o desktop) con 3 columnas en tiempo real que conecte los flujos JSON/ACP de tus agentes en una sola ventana.
