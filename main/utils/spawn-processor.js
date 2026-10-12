import { spawn } from "child_process";
import { buildProcessorChildEnv, invalidateSystemPythonCache } from "./processor-spawn.js";
import { validateMediaBinaries } from "./paths.js";

export function spawnProcessor({ command, args }) {
  const media = validateMediaBinaries();
  const mediaOpts = media.ok
    ? { ffmpegPath: media.ffmpegPath, ffprobePath: media.ffprobePath }
    : {};
  const proc = spawn(command, args, {
    windowsHide: true,
    env: buildProcessorChildEnv(process.env, mediaOpts),
  });
  proc.once("error", invalidateSystemPythonCache);
  return proc;
}
