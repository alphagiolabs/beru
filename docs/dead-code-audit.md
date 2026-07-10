# Auditoria y depuracion de codigo muerto (dead code)

Protocolo para auditar y eliminar codigo muerto en Beru **sin afectar funcionalidad**.
Reutilizable: copiar el prompt, aplicar las reglas, correr el gate.

---

## Prompt

```
Auditoria y depuracion de codigo muerto (dead code) en Beru, SIN afectar funcionalidad.

OBJETIVO
Identificar y eliminar codigo muerto real, de forma conservadora y verificada.
La prioridad absoluta es NO romper comportamiento existente. Ante la menor duda, reportar y NO eliminar.

ALCANCE
- src/ (renderer React), main/ (Electron), python/ (processor + helpers), scripts/, tests/
- package.json (dependencias no usadas)
- Archivos sueltos en la raiz (ej. `nul`)

METODOLOGIA (obligatoria)
1. Fase de inventario: lista candidatos por tipo (ver taxonomia abajo), con archivo:linea.
2. Fase de validacion: para CADA candidato, buscar referencias con `rg` en TODO el repo
   (incluyendo tests, scripts, strings, y patrones dinamicos) antes de tocar nada.
3. Fase de propuesta: entregar un reporte dividido en 3 bandas de confianza
   (alta / media / baja) ANTES de editar nada.
4. Esperar mi OK para la banda de alta confianza; la media/baja solo se documenta.
5. Al eliminar: commits pequenos y atomicos por tipo o por archivo.
6. Tras cada ronda de eliminacion, correr el gate de verificacion completo.

GATE DE VERIFICACION (HARD, tras cada cambio)
- npm run lint          -> 0 errores
- npm run format:check  -> 0 diffs
- npm test              -> todos pasan
- npm run test:python   -> si se toco python/
Si algo falla, revertir el cambio y reportarlo. No clamar "completado" sin
evidencia fresca de estos comandos (regla verification-before-completion).

MODO
Conservador. "Si dudo, lo dejo y lo reporto como sospechoso." Menos es mas,
pero nunca sacrificar seguridad por cantidad de lineas eliminadas.
```

---

## Reglas

### 1. Taxonomia de dead code - que cuenta

| Tipo                                           | Ejemplo                                                  | Confianza base               |
| ---------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| Imports sin usar                               | `import { foo } from './x'` donde `foo` no se referencia | Alta                         |
| Variables/constantes locales sin uso           | `const unused = ...`                                     | Alta                         |
| Funciones privadas nunca llamadas              | `function helper()` sin callers                          | Alta                         |
| Exports nunca referenciados en ningun lado     | `export const X` sin importadores                        | Media (ver falsos positivos) |
| Codigo despues de `return`/`throw`             | inalcanzable                                             | Alta                         |
| Ramas imposibles                               | `if (false)`, `if (typeof x === 'undefined' && x)`       | Alta                         |
| Codigo comentado que no es doc                 | `// const old = ...`                                     | Alta                         |
| TODOs huerfanos sin contexto accionable        | `// TODO arreglar`                                       | Alta                         |
| Archivos enteros nunca importados/empaquetados | modulo huerfano                                          | Media (ver falsos positivos) |
| Dependencias en package.json no referenciadas  | dep sin `import`/`require`                               | Media                        |
| Keys de i18n sin uso en UI                     | claves no referenciadas como string                      | Media                        |

### 2. Falsos positivos especificos de Beru - NUNCA eliminar sin verificacion cruzada

- **Electron IPC por string**: los handlers en `main/handlers/*.js` se registran con `ipcMain.handle('canal', ...)` y el renderer los invoca con `ipcRenderer.invoke('canal')`. El vinculo es un **string**, no un import. Verificar coincidencia exacta de canales antes de marcar un handler como muerto.
- **Handlers no registrados en `main/main.js`**: si un archivo de `main/handlers/` no se importa en `main.js`, todo el archivo puede ser dead, pero confirmar que ningun `require`/`import` dinamico lo carga.
- **Python empaquetado**: el instalador no incluye `.py` sueltos. Produccion usa `beru-processor.exe` (PyInstaller) empaquetado via `extraResources` `bin/`. Los modulos locales de `processor.py` deben estar en `beru-processor.spec` `hiddenimports` (cubierto por tests de packaging/spec).
- **`processor.py` como CLI**: tiene `if __name__ == '__main__'` y funciones invocadas via argparse/subcomandos. Un arg/subcomando no usado en JS puede seguir siendo API publica del binario: reportar, no borrar.
- **i18n dinamico**: `src/i18n/useT.js` y claves referenciadas como string interpolado (``t(`field.${id}`)``). Buscar la clave como substring, no como identificador.
- **Zustand slices**: actions exportadas de `src/stores/slices/*` pueden usarse solo en tests. Buscar en `tests/` antes de declararlas muertas.
- **Imports por side-effect**: `import './index.css'`, `import 'lucide-react'` (arbol), polyfills. Sin referencias nombradas pero necesarios.
- **Variables prefijadas `_`**: ESLint las ignora (`varsIgnorePattern: '^_'`) intencionalmente. No son dead code.
- **Feature flags / env vars**: ramas que dependen de `import.meta.env.VITE_*` o `process.env.*` pueden estar dormidas pero vivas.
- **Clases Tailwind construidas dinamicamente**: cadenas tipo `` `bg-${color}-500` ``. El purge de Tailwind ya las exige presentes; no tratar como strings muertos.
- **Archivo `nul` en la raiz**: en Windows `nul` es un nombre reservado; un archivo fisico con ese nombre es casi seguro basura, pero **preguntar antes** de borrarlo.
- **`build/`, `dist-installer/`, `bin/`**: output/artefactos, fuera de alcance.

### 3. Gate de verificacion (no negociable)

Despues de cada ronda de eliminacion, correr en orden y **pegar la salida real**:

```
npm run lint
npm run format:check
npm test
npm run test:python   # solo si se toco python/
```

Regla `verification-before-completion`: ningun claim de "listo" sin output fresco.
Si `lint` o `test` fallan por el cambio, se revierte ese cambio y se reporta.

### 4. Modo de operacion

- **Nunca eliminar en la primera pasada**: primero inventario + reporte por bandas.
- **Banda alta confianza**: eliminar tras OK, en commits atomicos.
- **Banda media/baja**: solo documentar con evidencia (`rg` counts), no editar.
- **Un cambio a la vez**: un archivo o un tipo de dead code por commit, para que un fallo del gate aisle el culpable.
- **No reformatear** codigo que no se toca (regla de Prettier del AGENTS.md).

### 5. Entregables esperados

1. Reporte (en chat o anexo a este doc) con: tabla de candidatos por banda, `archivo:linea`, tipo, evidencia de `rg` (cuantas refs encontradas y donde), y veredicto.
2. Commits atomicos con mensaje `chore: remove dead <tipo> -- <archivo>`.
3. Output final del gate de verificacion pegado.

### 6. Herramientas recomendadas (opcionales, low-risk)

- **ESLint ya activo**: `no-unused-vars` (warn) y `no-unreachable` (via `js.configs.recommended`). Correr `npm run lint` es la primera senal.
- **`knip`** (JS): detecta exports/archivos/deps no usados con analisis estatico. No esta instalado: correr una vez con `npx knip --no-exit-code` sin anadirlo al repo.
- **`vulture`** (Python): dead code en `python/`. `pipx run vulture python/ --min-confidence 80`. No dejarlo instalado.

---

## Uso

1. Copiar el prompt de arriba y pegarlo al agente.
2. El agente aplica las reglas y el gate de verificacion.
3. Aprobar la banda de alta confianza antes de cualquier edicion.
