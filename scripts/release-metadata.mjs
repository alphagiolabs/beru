import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const { extractFile } = require("@electron/asar");

export function validateReleaseSource(root, tag) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const version = pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`Invalid stable version: ${version}`);
  if (lock.version !== version || lock.packages?.[""]?.version !== version)
    throw new Error("package.json and package-lock.json versions differ");
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} differs from v${version}`);
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const entries = [...changelog.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\r?$/gm)];
  const matches = entries.filter((entry) => entry[1] === version);
  if (matches.length !== 1) throw new Error(`Expected one dated CHANGELOG entry for ${version}`);
  const entry = matches[0];
  if (entries[0] !== entry)
    throw new Error("Candidate version must be the first dated CHANGELOG entry");
  const date = new Date(`${entry[2]}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry[2])
    throw new Error("Invalid CHANGELOG date");
  const rest = changelog.slice(entry.index + entry[0].length);
  const notes = rest.split(/^## /m)[0].trim();
  if (
    !/^### (Added|Changed|Fixed|Removed|Deprecated|Security)\r?$/m.test(notes) ||
    !/^- \S/m.test(notes)
  )
    throw new Error("CHANGELOG entry must contain a section and release notes");
  return { version, notes };
}

export async function sha512File(path) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
}

export async function validateReleaseArtifacts(directory, version) {
  const metadata = load(readFileSync(join(directory, "latest.yml"), "utf8"));
  const name = `Beru-Setup-${version}.exe`;
  if (metadata.version !== version || metadata.path !== name || metadata.files?.length !== 1)
    throw new Error("latest.yml version/path/files do not match the candidate");
  const file = metadata.files[0];
  if (file.url !== name || basename(file.url) !== file.url)
    throw new Error("Unexpected installer URL");
  const installer = join(directory, name);
  const hash = await sha512File(installer);
  if (file.sha512 !== hash || metadata.sha512 !== hash || file.size !== statSync(installer).size)
    throw new Error("Installer size or SHA512 differs from latest.yml");
  if (!statSync(join(directory, `${name}.blockmap`)).size) throw new Error("Empty blockmap");
  const blockmap = JSON.parse(gunzipSync(readFileSync(join(directory, `${name}.blockmap`))));
  if (blockmap.version !== "2" || blockmap.files?.length !== 1) throw new Error("Invalid blockmap");
  const blocks = blockmap.files[0];
  if (
    blocks.offset !== 0 ||
    !blocks.sizes?.length ||
    blocks.sizes.length !== blocks.checksums?.length ||
    blocks.sizes.some((size) => !Number.isSafeInteger(size) || size <= 0) ||
    blocks.sizes.reduce((sum, size) => sum + size, 0) !== file.size
  )
    throw new Error("Blockmap does not describe the installer");
  return [installer, join(directory, `${name}.blockmap`), join(directory, "latest.yml")];
}

export function validatePackagedUpdateConfig(directory, version) {
  const resources = join(directory, "win-unpacked", "resources");
  const config = load(readFileSync(join(resources, "app-update.yml"), "utf8"));
  if (config.provider !== "github" || config.owner !== "alphagiolabs" || config.repo !== "beru")
    throw new Error("Packaged update provider differs from alphagiolabs/beru");
  const pkg = JSON.parse(extractFile(join(resources, "app.asar"), "package.json").toString());
  if (pkg.version !== version) throw new Error("Packaged app version differs from the candidate");
  const updater = extractFile(
    join(resources, "app.asar"),
    join("node_modules", "electron-updater", "package.json"),
  );
  if (!JSON.parse(updater.toString()).version) throw new Error("Packaged updater is missing");
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const args = process.argv.slice(2);
    const value = (flag) => {
      const index = args.indexOf(flag);
      if (index < 0) return undefined;
      if (!args[index + 1] || args[index + 1].startsWith("--"))
        throw new Error(`Missing value for ${flag}`);
      return args[index + 1];
    };
    const { version, notes } = validateReleaseSource(root, value("--tag"));
    const dist = value("--dist");
    if (dist) {
      await validateReleaseArtifacts(resolve(dist), version);
      if (!args.includes("--assets-only")) validatePackagedUpdateConfig(resolve(dist), version);
    }
    const notesFile = value("--notes");
    if (notesFile) writeFileSync(notesFile, notes + "\n", "utf8");
    console.log(
      `Release metadata verified: v${version}${dist ? " (SHA512, size, blockmap)" : " (source)"}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
