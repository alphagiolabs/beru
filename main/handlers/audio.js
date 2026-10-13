import fs from "node:fs/promises";
import path from "node:path";
import { showOpenDialog } from "../utils/dialog-history.js";
import { getMainWindow } from "../shared-state.js";
import { handleIpc } from "../utils/ipc.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { probeVideoFile } from "../videoProbe.js";
import { getFfprobePath } from "../utils/paths.js";
import { runMediaTask } from "../utils/media-task-pool.js";
import { invalidateBeruStatCache } from "../utils/beru-protocol.js";

export function registerAudioHandlers(pathSecurity) {
  const inspect = async (filePath) => {
    const check = pathSecurity.validateReadableFile(filePath, "audio");
    if (!check.ok) return { success: false, errorCode: "AUDIO_NOT_ALLOWED", error: check.error };
    const info = await runMediaTask(
      () =>
        probeVideoFile(check.resolvedPath, {
          ffprobePath: getFfprobePath(),
          allowFfmpegFallback: false,
        }),
      { interactive: true },
    );
    if (!info.audioCodec || !(info.duration > 0)) return { success: false, errorCode: "NO_AUDIO" };
    const stat = await fs.stat(check.resolvedPath);
    invalidateBeruStatCache(check.resolvedPath);
    return {
      success: true,
      path: check.resolvedPath,
      name: path.basename(check.resolvedPath),
      duration: info.duration,
      channels: info.audioChannels,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      version: `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`,
    };
  };
  handleIpc(IPC_INVOKE.statAudio, (_event, filePath) => inspect(filePath));
  handleIpc(IPC_INVOKE.pickAudio, async (_event, labels = {}) => {
    const { canceled, filePaths } = await showOpenDialog(getMainWindow(), {
      title: typeof labels?.title === "string" ? labels.title.slice(0, 100) : "Audio",
      properties: ["openFile"],
      filters: [
        {
          name: typeof labels?.filterName === "string" ? labels.filterName.slice(0, 100) : "Audio",
          extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif"],
        },
      ],
    });
    if (canceled || !filePaths?.length) return { success: false, canceled: true };
    const check = pathSecurity.registerSelectedPath(filePaths[0], "audio");
    if (!check.ok) return { success: false, errorCode: "AUDIO_NOT_ALLOWED", error: check.error };
    return inspect(check.resolvedPath);
  });
}
