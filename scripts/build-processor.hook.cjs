// electron-builder's `beforeBuild` config is loaded via require()/import() and
// is expected to export a function. The actual build-processor script is an
// ESM module (build-processor.mjs) that runs as a top-level side effect when
// spawned, so we wrap it in a CommonJS function that re-execs node on the
// .mjs entry. This keeps `npm run build:processor` untouched and gives
// electron-builder the function signature it expects.
//
// See: https://www.electron.build/configuration/configuration#Configuration-beforeBuild
// and node_modules/app-builder-lib/out/util/resolve.js (resolveFunction).

const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function beforeBuild() {
  const scriptPath = path.join(__dirname, "build-processor.mjs");
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`[build-processor.hook] build:processor exited with status ${result.status}`);
  }
};
