#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateReleaseSource,
  validateReleaseArtifacts,
  validatePackagedUpdateConfig,
} from "./release-metadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DRY_RUN = !process.argv.includes("--ship");
const SHOULD_BUILD = process.argv.includes("--build");
const LOCAL_ONLY = process.argv.includes("--local");
const REPO = "alphagiolabs/beru";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function run(cmd, opts = {}) {
  const label = cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd;
  console.log(`\n> ${label}`);
  const out = execSync(cmd, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: opts.silent ? "pipe" : "inherit",
    timeout: opts.timeout || 300_000,
    ...opts,
  });
  if (opts.silent) return out.trim();
  return out;
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
  console.log(`  [OK] ${label}`);
}

function fail(label, detail) {
  console.log(`  [FAIL] ${label}`);
  if (detail) console.log(`     ${detail}`);
  process.exit(1);
}

function skip(label) {
  console.log(`  [SKIP] ${label}`);
}

function validateEnvironment() {
  section("1/8  Entorno");

  if (LOCAL_ONLY) {
    skip("Validación local: no verifica auth, branch, tree, origin ni estado remoto");
    return;
  }

  try {
    const whoami = runCapture("gh api user --jq .login");
    if (whoami !== "alphagiolabs") {
      fail("gh auth", `Debe estar autenticado como alphagiolabs. Actual: ${whoami.slice(0, 80)}`);
    }
    ok("gh autenticado como alphagiolabs");
  } catch {
    fail("gh CLI", "gh no está instalado o no autenticado. Corre: gh auth login");
  }

  const remote = runCapture("git remote get-url origin");
  if (
    !/^https:\/\/github\.com\/alphagiolabs\/beru(?:\.git)?$|^git@github\.com:alphagiolabs\/beru(?:\.git)?$/.test(
      remote,
    )
  ) {
    fail("git remote", `Esperado alphagiolabs/beru, obtenido: ${remote}`);
  }
  ok(`remote: ${remote}`);

  const branch = runCapture("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") {
    fail(
      "branch",
      `Debes estar en main (actual: ${branch}). Haz checkout a main y trae los cambios.`,
    );
  }
  ok("branch: main");

  const status = runCapture("git status --porcelain");
  if (status) {
    fail("working tree", `Hay cambios sin commitear:\n${status}`);
  }
  ok("working tree limpio");

  const remoteHead = runCapture("git ls-remote origin refs/heads/main").split(/\s/)[0];
  if (!remoteHead || remoteHead !== runCapture("git rev-parse HEAD"))
    fail("main remoto", "HEAD debe coincidir exactamente con origin/main remoto antes de ship");
  ok("HEAD coincide con main remoto");
}

function detectVersion() {
  section("2/8  Versión");

  const pkg = readJson(resolve(ROOT, "package.json"));
  const version = pkg.version;
  console.log(`  package.json → v${version}`);

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail("semver", `Formato inválido: ${version}`);
  }
  ok(`v${version}`);

  if (LOCAL_ONLY) {
    skip("Conflictos de tags y releases pendientes de verificar antes de ship");
    return version;
  }

  const existing = runCapture(`git tag -l "v${version}"`);
  if (existing) {
    fail("tag duplicado", `El tag v${version} ya existe localmente.`);
  }

  if (runCapture(`git ls-remote origin refs/tags/v${version}`).trim())
    fail("tag remoto duplicado", `v${version} ya existe en origin`);
  const pages = JSON.parse(runCapture(`gh api repos/${REPO}/releases --paginate --slurp`));
  if (pages.flat().some((release) => release.tag_name === `v${version}`)) {
    fail("release duplicada", `v${version} ya existe en GitHub Releases.`);
  }

  return version;
}

function validateChangelog(version) {
  section("3/8  CHANGELOG.md (HARD RULE)");

  validateReleaseSource(ROOT, `v${version}`);
  ok(`CHANGELOG y lockfile coinciden con v${version}`);
}

function runQualityGate() {
  section("4/8  Quality Gate");

  console.log("  > npm run lint…");
  run("npm run lint", { timeout: 120_000 });
  ok("lint");

  console.log("  > npm run format:check…");
  run("npm run format:check", { timeout: 60_000 });
  ok("format");

  console.log("  > npm test…");
  run("npm test", { timeout: 300_000 });
  ok("tests");

  console.log("  > npm run test:python…");
  run("npm run test:python", { timeout: 300_000 });
  ok("python tests");
}

async function runBuild(version) {
  section("5/8  Build local");

  if (!SHOULD_BUILD) {
    skip("Build local (usa --build para activarlo, o CI lo hará al pushear el tag)");
    return;
  }

  console.log("  > npm run build:processor…");
  run("npm run build:processor", { timeout: 300_000 });
  ok("processor build");

  console.log("  > npm run build…");
  run("npm run build", { timeout: 600_000 });
  ok("build completo");

  const distDir = resolve(ROOT, "dist-installer");
  await validateReleaseArtifacts(distDir, version);
  validatePackagedUpdateConfig(distDir, version);
  const signingMode =
    process.env.BERU_SIGNING_MODE ||
    (process.env.CSC_LINK || process.env.WIN_CSC_LINK ? "signed" : "unsigned");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(ROOT, "scripts", "verify-installer-signature.ps1"),
      "-Mode",
      signingMode,
    ],
    { cwd: ROOT, stdio: "inherit", windowsHide: true },
  );
  ok("instalador verificado");
}

function createGitTag(version) {
  section("6/8  Git Tag");

  const tag = `v${version}`;

  if (DRY_RUN) {
    skip(`[dry-run] git tag ${tag}`);
    return tag;
  }

  const lastCommit = runCapture("git log -1 --pretty=%B");
  const isShipCommit = /^(fix|feat|chore):\s*ship\s+v/i.test(lastCommit);
  if (!isShipCommit) {
    console.log(`  [!] El último commit no es un ship commit directo (es un merge PR).`);
    console.log(`  [i] Taggeando igual: el merge PR trajo el cambio de versión.`);
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

  console.log(`\n  https://github.com/${REPO}/actions/workflows/ci-release.yml`);
}

function reportReleaseHandoff(version) {
  section("8/8  GitHub Release");

  console.log(
    `  CI es el único publicador de v${version}: borrador, validación, subida y publicación.`,
  );
  console.log(
    `  Pendiente: CI completada y recorrido de actualización desde una instalación anterior.`,
  );
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║        Beru Release Pipeline Loop            ║
║        ${DRY_RUN ? "DRY RUN — no se taggea ni pushea" : "SHIP MODE — taggeando y publicando"}
╚══════════════════════════════════════════════╝
`);

  const startTime = Date.now();

  try {
    if (LOCAL_ONLY && !DRY_RUN) throw new Error("--local cannot be combined with --ship");
    validateEnvironment();
    const version = detectVersion();
    validateChangelog(version);
    runQualityGate();
    await runBuild(version);
    const tag = createGitTag(version);
    pushTag(tag);
    reportReleaseHandoff(version);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (DRY_RUN) {
      console.log(`
╔══════════════════════════════════════════════╗
║   VALIDACIÓN COMPLETADA — sin publicar     ║
║   Para ejecutar el release real:             ║
║     node scripts/release-loop.mjs --ship     ║
╚══════════════════════════════════════════════╝
`);
    } else {
      console.log(`
╔══════════════════════════════════════════════╗
║        TAG v${version} ENVIADO A CI           ║
║        Duración: ${elapsed}s                  ║
║        https://github.com/${REPO}/releases/tag/v${version}
╚══════════════════════════════════════════════╝
`);
    }
  } catch (e) {
    console.error(`\n  Error: ${e.message}`);
    if (e.stdout) console.error(e.stdout);
    if (e.stderr) console.error(e.stderr);
    process.exit(1);
  }
}

main();
