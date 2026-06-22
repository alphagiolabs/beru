#!/usr/bin/env node
/**
 * Release Pipeline Loop — Beru
 * ==============================
 *
 * Trigger: ejecutar después de que un PR con `fix: ship v*` o `feat: ship v*`
 * se fusionó a main.
 *
 * Qué hace:
 *   1. Lee la versión de package.json
 *   2. Verifica que CHANGELOG.md tenga entrada para esta versión (HARD RULE)
 *   3. Verifica que estamos en main y el tree está limpio
 *   4. Ejecuta quality gate (lint + test)
 *   5. [Opcional] Corre npm run build (--build)
 *   6. Crea el git tag vX.Y.Z
 *   7. Pushea el tag → CI se encarga del build firmado + publish
 *   8. Crea GitHub Release con las notas del changelog
 *
 * STAGED ROLLOUT: To do a staged rollout, publish the GitHub Release as a
 * draft first, validate on a test machine, then make it public.
 * electron-updater only checks published releases, so drafts are invisible
 * to existing installations until you publish.
 *
 * Uso:
 *   node scripts/release-loop.mjs               # dry-run: valida todo, no taggea
 *   node scripts/release-loop.mjs --ship        # ejecuta el release completo
 *   node scripts/release-loop.mjs --ship --build # build local también
 *
 * Exit codes:
 *   0 = éxito (o dry-run sin errores)
 *   1 = validación fallida
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// ── Config ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DRY_RUN = !process.argv.includes("--ship");
const SHOULD_BUILD = process.argv.includes("--build");
const REPO = "alphagiolabs/beru";

// ── Helpers ────────────────────────────────────────────────────────────

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function run(cmd, opts = {}) {
  const label = cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd;
  console.log(`\n❯ ${label}`);
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: opts.silent ? "pipe" : "inherit",
      timeout: opts.timeout || 300_000,
      ...opts,
    });
    if (opts.silent) return out.trim();
    return out;
  } catch (e) {
    if (opts.silent) return e.stderr?.trim() || e.message;
    throw e;
  }
}

function runCapture(cmd) {
  return run(cmd, { silent: true });
}

function section(title) {
  console.log(`\n${"=".repeat(56)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(56)}`);
}

function ok(label) {
  console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
  process.exit(1);
}

function skip(label) {
  console.log(`  ⏭️  ${label}`);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function findFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  const regex = new RegExp(pattern);
  return files.filter((f) => regex.test(f)).map((f) => join(dir, f));
}

// ── Changelog Parser ────────────────────────────────────────────────────

/**
 * Busca la entrada de CHANGELOG.md para una versión específica.
 * Retorna el contenido de la entrada o null si no existe.
 */
function getChangelogEntry(version) {
  const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf-8");
  const header = `## [${version}]`;
  const idx = changelog.indexOf(header);
  if (idx === -1) return null;

  // Buscar el siguiente header de versión (## [X.Y.Z] o ## [Unreleased])
  const rest = changelog.slice(idx + header.length);
  const nextMatch = rest.match(/\n##\s\[/);
  const endIdx = nextMatch ? idx + header.length + nextMatch.index : changelog.length;

  return changelog.slice(idx, endIdx).trim();
}

// ── Validators ──────────────────────────────────────────────────────────

function validateEnvironment() {
  section("1/8  Entorno");

  // Verificar gh CLI
  try {
    const whoami = runCapture("gh auth status --show-token");
    if (!whoami.includes("alphagiolabs")) {
      fail("gh auth", `Debe estar autenticado como alphagiolabs. Actual: ${whoami.slice(0, 80)}`);
    }
    ok("gh autenticado como alphagiolabs");
  } catch {
    fail("gh CLI", "gh no está instalado o no autenticado. Corre: gh auth login");
  }

  // Verificar remote
  const remote = runCapture("git remote get-url origin");
  if (!remote.includes("alphagiolabs/beru")) {
    fail("git remote", `Esperado alphagiolabs/beru, obtenido: ${remote}`);
  }
  ok(`remote: ${remote}`);

  // Verificar que estamos en main
  const branch = runCapture("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") {
    fail(
      "branch",
      `Debes estar en main (actual: ${branch}). Haz checkout a main y trae los cambios.`,
    );
  }
  ok("branch: main");

  // Tree limpio
  const status = runCapture("git status --porcelain");
  if (status) {
    fail("working tree", `Hay cambios sin commitear:\n${status}`);
  }
  ok("working tree limpio");

  // Estamos al día con origin?
  let behind;
  try {
    behind = execFileSync("git", ["rev-list", "--count", "HEAD..origin/main"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
  } catch (error) {
    fail("git ancestry", error?.message || "No se pudo comparar HEAD con origin/main");
  }
  if (Number(behind) > 0) {
    fail("git pull", `main está ${behind} commits detrás de origin/main. Haz git pull primero.`);
  }
  ok("main está al día con origin");
}

function detectVersion() {
  section("2/8  Versión");

  const pkg = readJson(resolve(ROOT, "package.json"));
  const version = pkg.version;
  console.log(`  📦 package.json → v${version}`);

  // Validar semver
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail("semver", `Formato inválido: ${version}`);
  }
  ok(`v${version}`);

  // Validar que el tag no existe ya
  const existing = runCapture(`git tag -l "v${version}"`);
  if (existing) {
    fail("tag duplicado", `El tag v${version} ya existe localmente.`);
  }

  // Verificar que no esté publicado ya en GitHub Releases
  try {
    execSync(`gh release view "v${version}"`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
    fail("release duplicada", `v${version} ya existe en GitHub Releases.`);
  } catch {
    // gh release view falla si no existe — es lo esperado
  }

  return version;
}

function validateChangelog(version) {
  section("3/8  CHANGELOG.md (HARD RULE)");

  const entry = getChangelogEntry(version);
  if (!entry) {
    fail(
      "Entrada faltante",
      `CHANGELOG.md no tiene entrada para [${version}].\n` +
        `     Agrega un encabezado "## [${version}] - ${getToday()}" con ` +
        `las secciones ### Added, ### Changed, ### Fixed según corresponda.\n` +
        `     Esto es una HARD RULE — el release no puede continuar sin el changelog.`,
    );
  }

  // Validar estructura mínima (Keep a Changelog)
  const hasDate = entry.includes("- 20"); // YYYY-MM-DD
  const hasSection = /###\s+(Added|Changed|Fixed|Removed|Deprecated|Security)/.test(entry);

  if (!hasDate) {
    fail("changelog date", `La entrada [${version}] no tiene fecha (YYYY-MM-DD).`);
  }
  if (!hasSection) {
    fail(
      "changelog sections",
      `La entrada debe tener al menos una sección ### Added / ### Changed / ### Fixed.`,
    );
  }

  console.log(`  📝 Entrada encontrada:\n`);
  console.log(`  ${entry.split("\n").slice(0, 6).join("\n  ")}`);
  if (entry.split("\n").length > 6) console.log(`  … (${entry.split("\n").length - 6} líneas más)`);
  console.log();
  ok(`CHANGELOG.md tiene entrada para v${version}`);
}

function runQualityGate() {
  section("4/8  Quality Gate");

  console.log("  ▶️  npm run lint…");
  run("npm run lint", { timeout: 120_000 });
  ok("lint");

  console.log("  ▶️  npm run format:check…");
  run("npm run format:check", { timeout: 60_000 });
  ok("format");

  console.log("  ▶️  npm test…");
  run("npm test", { timeout: 300_000 });
  ok("tests");
}

function runBuild() {
  section("5/8  Build local");

  if (!SHOULD_BUILD) {
    skip("Build local (usa --build para activarlo, o CI lo hará al pushear el tag)");
    return;
  }

  console.log("  ▶️  npm run build:processor…");
  run("npm run build:processor", { timeout: 300_000 });
  ok("processor build");

  console.log("  ▶️  npm run build…");
  run("npm run build", { timeout: 600_000 });
  ok("build completo");

  // Verificar instalador con readdirSync (funciona en Windows)
  const distDir = resolve(ROOT, "dist-installer");
  if (!existsSync(distDir)) {
    fail("dist-installer/", "No existe el directorio dist-installer/ después del build");
  }

  const installers = findFiles(distDir, "\\.exe$");
  if (installers.length === 0) {
    fail("Instalador .exe", `No se encontró .exe en ${distDir}`);
  }

  console.log(`  📦 Instaladores encontrados:`);
  for (const inst of installers) {
    const name = inst.replace(/\\/g, "/").split("/").pop();
    console.log(`     - ${name}`);
  }
  ok("instalador verificado");
}

function createGitTag(version) {
  section("6/8  Git Tag");

  const tag = `v${version}`;

  if (DRY_RUN) {
    skip(`[dry-run] git tag ${tag}`);
    return tag;
  }

  // Validar que estamos en el commit correcto
  const lastCommit = runCapture("git log -1 --pretty=%B");
  const isShipCommit = /^(fix|feat|chore):\s*ship\s+v/i.test(lastCommit);
  if (!isShipCommit) {
    console.log(`  ⚠️  El último commit no es un ship commit directo (es un merge PR).`);
    console.log(`  ℹ️  Taggeando igual: el merge PR trajo el cambio de versión.`);
  }

  run(`git tag ${tag}`, { timeout: 10_000 });
  ok(`Tag ${tag} creado localmente`);
  return tag;
}

function pushTag(tag) {
  section("7/8  Push tag → CI");

  if (DRY_RUN) {
    skip(`[dry-run] git push origin ${tag}`);
    return;
  }

  run(`git push origin ${tag}`, { timeout: 60_000 });
  ok(`Tag ${tag} pusheado — CI Release Pipeline activado`);

  console.log(`\n  🔗 https://github.com/${REPO}/actions/workflows/ci-release.yml`);
}

function createGitHubRelease(version) {
  section("8/8  GitHub Release");

  const tag = `v${version}`;

  if (DRY_RUN) {
    skip(`[dry-run] gh release create ${tag}`);
    return;
  }

  const entry = getChangelogEntry(version);
  if (!entry) {
    fail("Changelog desapareció?", `La entrada para v${version} ya no está en CHANGELOG.md.`);
  }

  // Extraer solo las notas (sin el header ## [X.Y.Z] - fecha)
  const lines = entry.split("\n");
  const notes = lines.slice(1).join("\n").trim();

  // Escribir a archivo temporal para evitar problemas de escaping
  const tmpDir = mkdtempSync(join(tmpdir(), "beru-release-"));
  const notesFile = join(tmpDir, "release-notes.md");
  writeFileSync(notesFile, notes, "utf-8");

  const title = `${tag}`;

  // Buscar installers si el build local se hizo
  const distDir = resolve(ROOT, "dist-installer");
  let assets = "";
  if (existsSync(distDir)) {
    const exes = findFiles(distDir, "\\.exe$");
    const blockmaps = findFiles(distDir, "\\.exe\\.blockmap$");
    const yamls = findFiles(distDir, "latest\\.yml$");
    const allAssets = [...exes, ...blockmaps, ...yamls];
    if (allAssets.length > 0) {
      // Quote each asset path so paths with spaces don't break the shell
      // command. Double-quote and escape any embedded double-quotes.
      assets = allAssets.map((p) => `"${String(p).replace(/"/g, '\\"')}"`).join(" ");
    }
  }

  const cmd = `gh release create ${tag} --title "${title}" --notes-file "${notesFile}"${assets ? ` ${assets}` : ""}`;
  run(cmd, { timeout: 120_000 });
  ok(`Release ${tag} creado en GitHub`);

  console.log(`  🔗 https://github.com/${REPO}/releases/tag/${tag}`);
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║        Beru Release Pipeline Loop            ║
║        ${DRY_RUN ? "⚡ DRY RUN — no se taggea ni pushea" : "🚀 SHIP MODE — taggeando y publicando"}
╚══════════════════════════════════════════════╝
`);

  const startTime = Date.now();

  try {
    validateEnvironment();
    const version = detectVersion();
    validateChangelog(version);
    runQualityGate();
    runBuild();
    const tag = createGitTag(version);
    pushTag(tag);
    createGitHubRelease(version);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (DRY_RUN) {
      console.log(`
╔══════════════════════════════════════════════╗
║   ✅ DRY RUN COMPLETADO — todo validado     ║
║   Para ejecutar el release real:             ║
║     node scripts/release-loop.mjs --ship     ║
╚══════════════════════════════════════════════╝
`);
    } else {
      console.log(`
╔══════════════════════════════════════════════╗
║        ✅ RELEASE v${version} COMPLETADO      ║
║        ⏱️  ${elapsed}s                         ║
║        🔗 https://github.com/${REPO}/releases/tag/v${version}
╚══════════════════════════════════════════════╝
`);
    }
  } catch (e) {
    console.error(`\n  💥 Error: ${e.message}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    process.exit(1);
  }
}

main();
