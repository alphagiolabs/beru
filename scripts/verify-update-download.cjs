const { app } = require("electron");
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createReadStream,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const { load, dump } = require("js-yaml");

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1];
};
const from = value("--from");
const dist = value("--dist");
const fault = value("--fault");
const config = value("--config");
const runtime = value("--runtime");
const runtimePath = runtime ? resolve(runtime) : "electron-updater";
const { NsisUpdater } = require(runtimePath);
const { ElectronHttpExecutor } = require(
  runtime
    ? join(runtimePath, "out", "electronHttpExecutor")
    : "electron-updater/out/electronHttpExecutor",
);
const auditRoot = resolve(__dirname, "..", ".tmp", "update-audit");
let scratch;
const output = resolve(value("--output") || join(auditRoot, "evidence.json"));
const evidence = {
  from,
  source: dist ? "local" : "github",
  fault,
  scratch,
  events: [],
  installation: "not-executed",
  historicalBinary: false,
  runtimeVersion: require(
    runtime ? join(runtimePath, "package.json") : "electron-updater/package.json",
  ).version,
  configSource: config ? resolve(config) : "verification-generated",
};
let server;

async function main() {
  mkdirSync(auditRoot, { recursive: true });
  scratch = mkdtempSync(join(auditRoot, "download-"));
  evidence.scratch = scratch;
  app.setPath("userData", scratch);
  app.setPath("temp", scratch);
  if (!/^\d+\.\d+\.\d+$/.test(from || ""))
    throw new Error("--from requires a previous stable version");
  if (fault && (!dist || !["checksum", "metadata-404", "download-404"].includes(fault)))
    throw new Error("--fault requires --dist and checksum, metadata-404 or download-404");
  await app.whenReady();
  let feed = { provider: "github", owner: "alphagiolabs", repo: "beru" };
  if (dist) {
    const directory = resolve(dist);
    const manifest = load(readFileSync(join(directory, "latest.yml"), "utf8"));
    if (fault === "checksum") {
      manifest.sha512 = Buffer.alloc(64).toString("base64");
      manifest.files[0].sha512 = manifest.sha512;
    }
    server = createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
      if (
        (fault === "metadata-404" && name === "latest.yml") ||
        (fault === "download-404" && name === manifest.path)
      ) {
        response.writeHead(404).end("Intentional verification fault");
      } else if (name === "latest.yml") {
        response.end(dump(manifest));
      } else if (name === manifest.path || name === `${manifest.path}.blockmap`) {
        const stream = createReadStream(join(directory, name));
        stream.on("error", () => response.destroy());
        response.setHeader(
          "Content-Length",
          name === manifest.path
            ? manifest.files[0].size
            : require("node:fs").statSync(join(directory, name)).size,
        );
        stream.pipe(response);
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    feed = { provider: "generic", url: `http://127.0.0.1:${server.address().port}/` };
  }
  const updateConfig = join(scratch, "app-update.yml");
  writeFileSync(
    updateConfig,
    config
      ? readFileSync(resolve(config))
      : dump({ ...feed, updaterCacheDirName: "verification-cache" }),
  );
  const adapter = {
    version: from,
    name: "beru-update-verification",
    isPackaged: true,
    appUpdateConfigPath: updateConfig,
    userDataPath: scratch,
    baseCachePath: scratch,
    whenReady: () => app.whenReady(),
    onQuit: () => {},
    quit: () => {
      throw new Error("Installation is forbidden in the download verifier");
    },
    relaunch: () => {
      throw new Error("Relaunch is forbidden in the download verifier");
    },
  };
  const updater = new NsisUpdater(null, adapter);
  updater.httpExecutor = new ElectronHttpExecutor();
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;
  // A clean verification cache has no previous installer for differential download.
  updater.disableDifferentialDownload = true;
  if (dist) updater.setFeedURL(feed);
  for (const event of [
    "checking-for-update",
    "update-available",
    "update-not-available",
    "download-progress",
    "update-downloaded",
    "error",
  ]) {
    updater.on(event, (data) => {
      const item = {
        event,
        version: data?.version,
        percent: data?.percent,
        transferred: data?.transferred,
        total: data?.total,
        code: data?.code,
        message: data instanceof Error ? data.message : undefined,
      };
      evidence.events.push(item);
      console.log(JSON.stringify(item));
    });
  }
  const check = await updater.checkForUpdates();
  if (!evidence.events.some((item) => item.event === "update-available"))
    throw new Error("No update was detected from the requested previous version");
  const files = await updater.downloadUpdate();
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(files[0])) hash.update(chunk);
  evidence.version = check.updateInfo.version;
  evidence.sha512 = hash.digest("base64");
  if (evidence.sha512 !== check.updateInfo.files[0].sha512)
    throw new Error("Downloaded SHA512 differs");
  if (!evidence.events.some((item) => item.event === "download-progress"))
    throw new Error("No real download progress received");
  if (!evidence.events.some((item) => item.event === "update-downloaded"))
    throw new Error("No verified update-downloaded event");
  evidence.result = "download-verified";
}

main()
  .catch((error) => {
    evidence.result = "error";
    evidence.error = { code: error.code, message: error.message };
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    mkdirSync(require("node:path").dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
    console.log(`Evidence: ${output}`);
    server?.close();
    app.exit(process.exitCode || 0);
  });
