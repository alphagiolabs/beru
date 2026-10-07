# Releasing — Beru

Flujo de git y releases. Leer al commitear, pushear, abrir PR o preparar una release.

## Flujo de git

- Branch base: `main`. Todo entra vía PR; no pushear directamente a `main` sin PR.
- Commits de release: `fix: ship vX.Y.Z — descripción` o `feat: ship vX.Y.Z — descripción`.
- `CHANGELOG.md` debe tener una entrada `## [X.Y.Z] - YYYY-MM-DD` con secciones `### Added/Changed/Fixed/...` antes de shipear; sin ella, el pipeline falla.

## Release pipeline

El pipeline corre después de mergear a `main` un commit `fix/feat: ship vX.Y.Z`. La skill `/release-pipeline` (`.agents/skills/release-pipeline/SKILL.md`, la invoca el usuario) y `scripts/release-loop.mjs` son la fuente de verdad del proceso:

1. `git checkout main && git pull`.
2. `node scripts/release-loop.mjs --ship` — valida entorno, versión, CHANGELOG y quality gate; crea el tag `vX.Y.Z` y lo pushea.
3. CI compila, verifica los assets y publica la GitHub Release con el instalador.

`node scripts/release-loop.mjs` sin flags es un dry-run; `--build` añade el build local, `--local` valida en tree sucio y es incompatible con `--ship`. Push, tags y GitHub Releases requieren una solicitud explícita; no se infieren del commit ni del merge.

## Firma del instalador

El instalador es unsigned por ahora (`verifyUpdateCodeSignature: false`). CI puede firmar si se configuran `WINDOWS_CERTIFICATE_BASE64` / `WINDOWS_CERTIFICATE_PASSWORD`.
