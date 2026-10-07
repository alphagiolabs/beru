# CODING_STANDARDS — Beru

Convenciones de código y simplificación. Leer antes de escribir o editar código.

## Convenciones

- **ESM** en todo el repo (`"type": "module"` en `package.json`); los scripts CommonJS usan extensión `.cjs`.
- **React 19 JSX runtime** — no importar `React` explícitamente.
- **Zustand** para el estado global (`src/stores/`); no usar Context para estado compartido.
- **i18n** — todo string de UI va en `src/i18n/`, nunca hardcodeado en componentes.
- **Comentarios** solo cuando el código no se explica por sí mismo.
- **Prettier** es la fuente de verdad de formato; no reformatear código existente sin motivo.

## Simplificación de código

Cuando la tarea incluya auditoría, refactor o limpieza, invocar **`/simplificar`** (`.agents/skills/simplificar/SKILL.md`). En una feature o bugfix, simplificar solo lo claramente ligado al cambio o lo pedido por el usuario.

Aplicar esta mentalidad en cada cambio:

- **Eliminar dead code** — funciones, variables, imports, ramas `if/else` y bloques que nunca se ejecutan o cuyo resultado no se usa.
- **Eliminar redundancia** — lógica duplicada que puede consolidarse en una sola función o abstracción.
- **Preferir menos líneas** sin sacrificar legibilidad.
- **Eliminar código comentado** — el historial de git lo conserva.
- **Eliminar o resolver TODOs** sin contexto accionable.

Antes de eliminar código, validar contra los falsos positivos de Beru en `docs/dead-code-audit.md`.

La simplificación nunca rompe comportamiento ni tests. En caso de duda, dejar el código como está y preguntar.
