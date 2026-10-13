import fs from "node:fs/promises";
import { getMainWindow } from "../shared-state.js";
import { showOpenDialog, showSaveDialog } from "../utils/dialog-history.js";
import { handleIpc } from "../utils/ipc.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import {
  parseCompositionDocument,
  COMPOSITION_JOB_ID,
  compositionMediaPaths,
} from "../../shared/composition-document.js";
import { restoreSessionPaths } from "../utils/restore-session-paths.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";
import { executeProcessingRun } from "../processing-run.js";
import { validateProcessorAvailableAsync } from "../utils/processor-spawn.js";
import { validateMediaBinaries } from "../utils/paths.js";
import { sanitizeBatchJobMedia } from "../utils/process-media-validation.js";
import { validateBatchOutputPaths } from "../utils/process-output.js";
import { findUnreadableInputsAsync } from "../utils/process-input-validation.js";
import {
  captureProcessingPreparation,
  isProcessingPreparationCurrent,
} from "../utils/process-preparation.js";

const label = (labels, key) =>
  typeof labels?.[key] === "string" ? labels[key].slice(0, 100) : "Composition";
const validCanvas = (canvas) =>
  [canvas?.width, canvas?.height].every(
    (value) => Number.isInteger(value) && value >= 16 && value <= 4096 && value % 2 === 0,
  ) && ["contain", "cover"].includes(canvas.fit);

export function registerCompositionHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.startComposition, async (_event, payload) => {
    const generation = captureProcessingPreparation();
    const { jobs, manifest, error } = unwrapJobManifest(payload),
      job = jobs?.[0];
    if (
      error ||
      jobs?.length !== 1 ||
      job?.kind !== "composition" ||
      job.id !== COMPOSITION_JOB_ID ||
      !validCanvas(job.canvas) ||
      !Number.isFinite(job.composition_fps) ||
      job.composition_fps < 1 ||
      job.composition_fps > 120 ||
      !Array.isArray(job.clips) ||
      job.clips.length < 2 ||
      job.clips.length > 50 ||
      job.clips.some((clip) => !clip || (clip.kind && clip.kind !== "video"))
    )
      return { success: false, errorCode: "COMPOSITION_INVALID" };
    const spawnSpec = await validateProcessorAvailableAsync();
    if (!spawnSpec.ok) return { success: false, error: spawnSpec.error };
    const binaries = validateMediaBinaries();
    if (!binaries.ok) return { success: false, error: binaries.error };
    const outputDirectory = pathSecurity.getOutputDirectory();
    if (!outputDirectory) return { success: false, errorCode: "OUTPUT_NOT_SELECTED" };
    let safeJobs;
    try {
      safeJobs = await sanitizeBatchJobMedia([job], pathSecurity, { outputDirectory });
      await validateBatchOutputPaths(safeJobs);
      const unreadable = await findUnreadableInputsAsync(safeJobs);
      if (unreadable.length)
        return { success: false, errorCode: "MEDIA_UNREADABLE", unreadableInputs: unreadable };
    } catch (error) {
      return { success: false, error: error.message };
    }
    if (!isProcessingPreparationCurrent(generation)) return { success: false, cancelled: true };
    return executeProcessingRun({ manifest, jobs: safeJobs, outputDirectory, spawnSpec });
  });
  handleIpc(IPC_INVOKE.saveComposition, async (_event, value, labels) => {
    const document = parseCompositionDocument(value);
    if (!document) return { success: false, errorCode: "COMPOSITION_INVALID" };
    const { canceled, filePath } = await showSaveDialog(getMainWindow(), {
      title: label(labels, "saveTitle"),
      defaultPath: "composition.beru-composition.json",
      filters: [{ name: label(labels, "filterName"), extensions: ["json"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    await fs.writeFile(filePath, JSON.stringify(document, null, 2), "utf8");
    return { success: true, filePath };
  });
  handleIpc(IPC_INVOKE.loadComposition, async (_event, labels) => {
    const { canceled, filePaths } = await showOpenDialog(getMainWindow(), {
      title: label(labels, "loadTitle"),
      properties: ["openFile"],
      filters: [{ name: label(labels, "filterName"), extensions: ["json"] }],
    });
    if (canceled || !filePaths?.length) return { success: false, canceled: true };
    const check = pathSecurity.registerSelectedPath(filePaths[0], "project");
    if (!check.ok) return { success: false, error: check.error };
    const stat = await fs.stat(check.resolvedPath);
    if (stat.size > 5 * 1024 * 1024) return { success: false, errorCode: "COMPOSITION_INVALID" };
    let document;
    try {
      document = parseCompositionDocument(
        JSON.parse(await fs.readFile(check.resolvedPath, "utf8")),
      );
    } catch {
      return { success: false, errorCode: "COMPOSITION_INVALID" };
    }
    return document
      ? {
          success: true,
          document,
          paths: restoreSessionPaths(pathSecurity, compositionMediaPaths(document)),
        }
      : { success: false, errorCode: "COMPOSITION_INVALID" };
  });
}
