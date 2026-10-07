# Repo map — Beru

Stack, estructura y entorno. Leer para ubicar código, entender la arquitectura o diagnosticar problemas de entorno. Los comandos viven en `package.json` (`scripts`).

## Stack

| Capa        | Tecnología                                                      |
| ----------- | --------------------------------------------------------------- |
| Renderer    | React 19 + Vite 5 + Tailwind CSS 3 + Zustand 4                  |
| Main        | Electron 35 (ESM, `main/main.js` + `main/preload.cjs`)          |
| Procesador  | Python 3.12 (`python/processor.py`) empaquetado con PyInstaller |
| Auth        | Supabase v2 (`@supabase/supabase-js`)                           |
| Build       | electron-builder 25 (NSIS x64) + Vite 5                         |
| Tests       | Vitest 1 (JS) + `python/test_*.py`                              |
| Lint/Format | ESLint 9 + Prettier 3                                           |

## Estructura del repositorio

```
main/            Proceso principal de Electron (ESM; main.js, preload.cjs, handlers/, utils/, pets/)
src/             Renderer React (main.jsx, App.jsx, components/, hooks/, stores/, utils/, lib/, theme/, i18n/, features/)
python/          Procesador de video (processor.py, encode_profiles.py, delogo_chains.py, ..., test_*.py junto al código)
scripts/         Dev (dev.mjs), build (build-processor.mjs, electron-builder.config.cjs), fetch-ffmpeg, release-loop, verify
tests/           Tests de Vitest (.test.js / .test.jsx)
resources/       Presets (.beru.json), encode-profiles.json, catálogo de pets y fixtures de layout
shared/          Módulos compartidos entre main y renderer (job-manifest.js, project-document.js, ...)
bin/             FFmpeg, ffprobe y beru-processor.exe (generados, gitignored)
build/           Output de Vite (renderer compilado)
dist-installer/  Output de electron-builder (.exe)
docs/            Documentación para agentes (repo-map.md, releasing.md, dead-code-audit.md)
.agents/skills/  Skills instaladas (SKILL.md por skill)
CONTEXT.md       Glosario del dominio
DESIGN.md        Sistema visual del renderer
CODING_STANDARDS.md  Convenciones de código y simplificación
CHANGELOG.md     Historial de releases (entrada obligatoria por versión)
```

## Entorno

- `bin/` se puebla en `npm install` (postinstall descarga FFmpeg y ffprobe); `npm run fetch:ffmpeg` lo fuerza y `npm run build:processor` genera `beru-processor.exe`.
- `npm run build` compila el renderer **y** empaqueta el instalador completo; para solo el renderer, `vite build`.
- `.env` está gitignored. Las vars `VITE_*` se baken en build time; CI inyecta `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Si faltan, el build sigue pero sin login (`isSupabaseConfigured = false`).
- Los videos de entrada deben estar en disco local (no en modo "solo nube" de OneDrive/Drive/Dropbox).
