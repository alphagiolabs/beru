# Definition of Done

Esta es la matriz común para decidir cuándo una tarea está terminada. Las instrucciones de una tarea, un ticket o una skill pueden añadir comprobaciones, pero no convierten en obligatorias las que no aplican al alcance.

## Alcance y seguridad

- Los criterios de aceptación están satisfechos o se documenta claramente cualquier excepción.
- Solo se modificaron archivos relacionados con la tarea; los cambios preexistentes o ajenos no se reescribieron ni se incluyeron por accidente.
- No se borraron ni sobrescribieron datos de propósito incierto sin aprobación explícita.
- Commits, push, publicaciones, releases, despliegues y CLIs externas con efectos remotos solo se ejecutaron cuando la solicitud o el workflow activo los autorizó.

## Verificación por tipo de cambio

| Alcance                                 | Comprobaciones mínimas                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| JavaScript, React, Electron o tests JS  | `npm run lint`, `npm run format:check`, `npm test`                                                                         |
| Python                                  | Las comprobaciones JS aplicables y `npm run test:python`                                                                   |
| Configuración, build o empaquetado      | Comprobaciones anteriores según el código afectado y el comando específico de build solicitado o requerido                 |
| Documentación, `AGENTS.md` o `SKILL.md` | `npm run format:check` y revisión de enlaces, rutas y sintaxis; tests de comportamiento solo si se modificó comportamiento |

## Resultado

- Un fallo introducido por el cambio mantiene la tarea incompleta hasta corregirlo o recibir una decisión explícita sobre la excepción.
- Un fallo reproducible en la línea base se reporta como preexistente con su comando y salida relevante.
- Si una comprobación no puede ejecutarse por una limitación del entorno, se reporta la limitación y no se presenta como verificada.
- No es obligatorio dejar un commit ni un worktree limpio salvo que el usuario o el workflow activo lo haya solicitado explícitamente.
