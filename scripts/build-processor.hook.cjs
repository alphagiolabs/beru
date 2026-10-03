// electron-builder expects a hook function; the ESM script runs on import.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function beforeBuild() {
  for (const name of ["fetch-ffmpeg.mjs", "build-processor.mjs"]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, name)], {
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`[build-processor.hook] ${name} exited with status ${result.status}`);
    }
  }
  return true;
};
