import { startExportRun } from "../utils/start-export-run.js";
import fs from "node:fs/promises";
import { getMainWindow } from "../shared-state.js";
import { showOpenDialog, showSaveDialog } from "../utils/dialog-history.js";
import { handleIpc } from "../utils/ipc.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { validateCompositionJob } from "../../shared/composition-settings.js";
import {
  parseCompositionDocument,
  COMPOSITION_JOB_ID,
  compositionMediaPaths,
} from "../../shared/composition-document.js";
import { restoreSessionPaths } from "../utils/restore-session-paths.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";

const label = (labels, key) =>
  typeof labels?.[key] === "string" ? labels[key].slice(0, 100) : "Composition";

export function registerCompositionHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.startComposition, async (_event, payload, options) => {
    const { jobs, manifest, error } = unwrapJobManifest(payload),
      job = jobs?.[0];
    if (
      error ||
      jobs?.length !== 1 ||
      job?.kind !== "composition" ||
      job.id !== COMPOSITION_JOB_ID ||
      validateCompositionJob(job)
    )
      return { success: false, errorCode: "COMPOSITION_INVALID" };
    return startExportRun({ manifest, jobs }, pathSecurity, options);
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
