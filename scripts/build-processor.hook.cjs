// electron-builder expects a hook function; the ESM script runs on import.

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
  return true;
};
