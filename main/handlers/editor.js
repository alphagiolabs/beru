import { app } from "electron";
import fs from "fs";
import path from "path";
import { getMainWindow } from "../shared-state.js";
import { showOpenDialog, showSaveDialog } from "../utils/dialog-history.js";
import { IPC_INVOKE, IPC_EVENTS } from "../../shared/ipc-channels.js";
import { createHash } from "crypto";
import { validateCompositionJob } from "../../shared/composition-settings.js";
import { normalizeJob, jobMediaSources } from "../../shared/job-manifest.js";
import { buildJobManifest } from "../../shared/build-job-manifest.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";
import { sanitizeBatchJobMedia } from "../utils/process-media-validation.js";
import { validateBatchOutputPaths } from "../utils/process-output.js";
import { handleIpc } from "../utils/ipc.js";
import { probeVideo } from "../utils/video-cache.js";
import { runMediaTask } from "../utils/media-task-pool.js";
import { validateMediaBinaries } from "../utils/paths.js";
import { validateProcessorAvailableAsync } from "../utils/processor-spawn.js";
import { executeProcessingRun, cancelRun } from "../processing-run.js";
import {
  captureProcessingPreparation,
  isProcessingPreparationCurrent,
  cancelProcessingPreparation,
} from "../utils/process-preparation.js";
import {
  clearAutosave,
  identityChanged,
  inspectAssets,
  readAutosave,
  readEditorDocument,
  writeAutosave,
  writeEditorDocument,
} from "../utils/editor-document-io.js";

const DOCUMENT_FILTER = {
  name: "Proyecto de edición Beru",
  extensions: ["beru-edit.json", "json"],
};
const VIDEO_FILTER = {
  name: "Video",
  extensions: ["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg"],
};
const IMAGE_FILTER = {
  name: "Imagen",
  extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
};

const PROXY_CACHE_MAX = 20;

const autosavePath = () => path.join(app.getPath("userData"), "editor-autosave.json");

export function registerEditorHandlers(pathSecurity) {
  const documentPaths = new Set();
  let publishedFrame = null;
  let autosaveIO = Promise.resolve();
  const updateAutosave = (operation) => {
    const result = autosaveIO.then(operation);
    autosaveIO = result.catch(() => {});
    return result;
  };

  handleIpc(IPC_INVOKE.openEditorProject, async () => {
    const { canceled, filePaths } = await showOpenDialog(getMainWindow(), {
      title: "Abrir proyecto de edición",
      properties: ["openFile"],
      filters: [DOCUMENT_FILTER],
    });
    if (canceled || !filePaths?.length) return { success: false, canceled: true };
    const check = pathSecurity.registerSelectedPath(filePaths[0], "project");
    if (!check.ok) return { success: false, error: check.error };
    const loaded = await readEditorDocument(check.resolvedPath);
    if (!loaded.ok) return { success: false, error: loaded.error };
    documentPaths.add(check.resolvedPath);
    return {
      success: true,
      filePath: check.resolvedPath,
      project: loaded.project,
      assets: inspectAssets(loaded.project.assets, pathSecurity),
    };
  });

  handleIpc(
    IPC_INVOKE.saveEditorProject,
    async (_event, { project, baseRevision, filePath = null, saveAs = false }) => {
      if (!saveAs && filePath && !documentPaths.has(filePath))
        return { success: false, error: "Ruta de documento no autorizada" };
      const chooseNewPath = saveAs || !filePath;
      if (chooseNewPath) {
        const { canceled, filePath: chosen } = await showSaveDialog(getMainWindow(), {
          title: "Guardar proyecto de edición",
          defaultPath: "proyecto.beru-edit.json",
          filters: [DOCUMENT_FILTER],
        });
        if (canceled || !chosen) return { success: false, canceled: true };
        filePath = chosen.toLowerCase().endsWith(".json") ? chosen : `${chosen}.beru-edit.json`;
      }
      const result = await writeEditorDocument(
        filePath,
        { ...project, updatedAt: new Date().toISOString() },
        { baseRevision: chooseNewPath ? undefined : baseRevision },
      );
      if (!result.ok)
        return { success: false, error: result.error, conflict: result.conflict === true };
      documentPaths.add(filePath);
      await updateAutosave(async () => {
        const current = await readAutosave(autosavePath());
        if (current.ok && JSON.stringify(current.autosave?.project) === JSON.stringify(project))
          await clearAutosave(autosavePath());
      });
      return { success: true, filePath, revision: result.revision };
    },
  );

  handleIpc(IPC_INVOKE.pickEditorReplacement, async (_event, payload) => {
    const kind = payload?.kind === "image" ? "image" : "video";
    return pickMedia(pathSecurity, kind, kind === "image" ? "Buscar imagen" : "Buscar video");
  });

  handleIpc(IPC_INVOKE.writeEditorAutosave, async (_event, { project }) => {
    const result = await updateAutosave(() => writeAutosave(autosavePath(), project));
    return result.ok ? { success: true } : { success: false, error: result.error };
  });

  handleIpc(IPC_INVOKE.readEditorAutosave, async () => {
    const result = await updateAutosave(() => readAutosave(autosavePath()));
    return result.ok
      ? { success: true, autosave: result.autosave }
      : { success: false, error: result.error };
  });

  handleIpc(IPC_INVOKE.clearEditorAutosave, async () => {
    await updateAutosave(() => clearAutosave(autosavePath()));
    return { success: true };
  });

  handleIpc(IPC_INVOKE.importEditorVideos, async (_event, payload) => {
    let paths = Array.isArray(payload?.paths) ? payload.paths : null;
    if (!paths) {
      const { canceled, filePaths } = await showOpenDialog(getMainWindow(), {
        title: "Importar videos al editor",
        properties: ["openFile", "multiSelections"],
        filters: [VIDEO_FILTER],
      });
      if (canceled || !filePaths?.length) return { success: false, canceled: true };
      paths = filePaths;
    }
    const sources = [];
    const errors = [];
    for (const filePath of paths) {
      const check = pathSecurity.registerSelectedPath(filePath, "video");
      if (!check.ok) {
        errors.push({ path: filePath, error: check.error });
        continue;
      }
      const described = await describeMedia(check.resolvedPath, "video");
      if (described.ok) sources.push(described.source);
      else errors.push({ path: filePath, error: described.error });
    }
    return { success: true, sources, errors };
  });

  handleIpc(IPC_INVOKE.importEditorImage, () =>
    pickMedia(pathSecurity, "image", "Importar imagen"),
  );

  handleIpc(IPC_INVOKE.exportEditorComposition, async (_event, { manifest }) => {
    const ready = await prepareRender(manifest, pathSecurity, "editor:export");
    if (!ready.success) return ready;

    const { canceled, filePath } = await showSaveDialog(getMainWindow(), {
      title: "Exportar montaje a MP4",
      defaultPath: "montaje.mp4",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (!isProcessingPreparationCurrent(ready.preparation))
      return { success: false, cancelled: true };
    if (canceled || !filePath) return { success: false, canceled: true };
    const output = filePath.toLowerCase().endsWith(".mp4") ? filePath : `${filePath}.mp4`;
    if (jobMediaSources(ready.job).some((source) => samePath(source.path, output))) {
      return { success: false, error: "La salida no puede reemplazar una fuente del montaje" };
    }

    const result = await renderTo(ready, output, "export", pathSecurity);
    return result.success ? { ...result, filePath: result.path } : result;
  });

  handleIpc(IPC_INVOKE.renderEditorExactFrame, async (_event, { manifest, requestId }) => {
    if (typeof requestId !== "string" || !/^[\w-]{1,64}$/.test(requestId)) {
      return { success: false, error: "Identificador de vista inválido" };
    }
    const ready = await prepareRender(manifest, pathSecurity, "editor:frame");
    if (!ready.success) return ready;

    const framesDir = path.join(app.getPath("userData"), "editor-frames");
    const output = path.join(framesDir, `${requestId}.png`);
    await fs.promises.mkdir(framesDir, { recursive: true });
    const result = await renderTo(ready, output, "frame", pathSecurity);
    if (result.success) {
      if (publishedFrame && publishedFrame !== result.path)
        await fs.promises.rm(publishedFrame, { force: true }).catch(() => {});
      publishedFrame = result.path;
    }
    return result.success ? { success: true, path: result.path, requestId } : result;
  });

  handleIpc(IPC_INVOKE.cancelEditorExport, async (_event, payload) => {
    const owner = payload?.kind === "frame" ? "editor:frame" : "editor:export";
    cancelProcessingPreparation(owner);
    return cancelRun({ owner });
  });

  handleIpc(IPC_INVOKE.createEditorPreviewProxy, async (_event, { source }) => {
    const problem = sourceProblem(source, pathSecurity);
    if (problem) return { success: false, error: problem };
    const proxyPath = previewProxyPath(source);
    if (fs.existsSync(proxyPath)) {
      const now = new Date();
      await fs.promises.utimes(proxyPath, now, now).catch(() => {});
      return { success: true, path: proxyPath, reused: true };
    }

    const manifest = buildPreviewProxyManifest(source, proxyPath);
    const ready = await prepareRender(manifest, pathSecurity, "editor:proxy");
    if (!ready.success) return ready;

    await fs.promises.mkdir(path.dirname(proxyPath), { recursive: true });
    const result = await renderTo(ready, proxyPath, "proxy", pathSecurity);
    if (!result.success) return result;
    await pruneProxies(path.dirname(proxyPath));
    return { success: true, path: result.path };
  });
}

export function sourceDescriptor(filePath, stat, info) {
  return {
    path: filePath,
    filename: path.basename(filePath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    metadata: {
      durationUs: Math.round(info.duration * 1_000_000),
      width: info.width,
      height: info.height,
      hasAudio: Boolean(info.audioCodec),
    },
  };
}

async function pickMedia(pathSecurity, kind, title) {
  const { canceled, filePaths } = await showOpenDialog(getMainWindow(), {
    title,
    properties: ["openFile"],
    filters: [kind === "image" ? IMAGE_FILTER : VIDEO_FILTER],
  });
  if (canceled || !filePaths?.length) return { success: false, canceled: true };
  const check = pathSecurity.registerSelectedPath(filePaths[0], kind);
  if (!check.ok) return { success: false, error: check.error };
  const described = await describeMedia(check.resolvedPath, kind);
  return described.ok
    ? { success: true, source: described.source }
    : { success: false, error: described.error };
}

async function describeMedia(filePath, kind) {
  const stat = await fs.promises.stat(filePath);
  const info = await runMediaTask(() => probeVideo(filePath), { interactive: true });
  if (kind === "image") {
    if (!(info.width > 0 && info.height > 0))
      return { ok: false, error: "No se pudo leer la imagen" };
    const source = sourceDescriptor(filePath, stat, info);
    return {
      ok: true,
      source: { ...source, metadata: { ...source.metadata, durationUs: null, hasAudio: false } },
    };
  }
  if (!(info.width > 0 && info.height > 0 && info.duration > 0)) {
    return { ok: false, error: "No se pudo leer el video" };
  }
  return { ok: true, source: sourceDescriptor(filePath, stat, info) };
}

export function previewProxyName(source) {
  const key = `${source.path.toLowerCase()}|${source.sizeBytes}|${Math.round(source.mtimeMs)}`;
  return `${createHash("sha1").update(key).digest("hex").slice(0, 20)}.mp4`;
}

export async function pruneProxies(dir, max = PROXY_CACHE_MAX) {
  const names = await fs.promises.readdir(dir).catch(() => []);
  const proxies = await Promise.all(
    names
      .filter((name) => name.endsWith(".mp4"))
      .map(async (name) => {
        const file = path.join(dir, name);
        const stat = await fs.promises.stat(file).catch(() => null);
        return stat && { file, mtimeMs: stat.mtimeMs };
      }),
  );
  const stale = proxies
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(max);
  await Promise.all(stale.map(({ file }) => fs.promises.rm(file, { force: true }).catch(() => {})));
}

function previewProxyPath(source) {
  return path.join(app.getPath("userData"), "editor-proxies", previewProxyName(source));
}

function buildPreviewProxyManifest(source, outputPath) {
  const clip = normalizeJob({
    input_path: source.path,
    video_duration: source.durationUs / 1e6,
    trim_start: 0,
    trim_end: source.durationUs / 1e6,
    source_identity: { sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs },
  });
  return buildJobManifest([
    {
      id: -1,
      kind: "composition",
      clips: [clip],
      canvas: { width: 960, height: 540, fit: "contain", background: "#000000" },
      composition_fps: 30,
      encode_profile: "fast",
      output_path: outputPath,
    },
  ]);
}

async function prepareRender(payload, pathSecurity, owner) {
  const preparation = captureProcessingPreparation(owner);
  try {
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error) throw new Error(error);
    if (jobs?.length !== 1) throw new Error("La composición no tiene un job válido");
    const job = jobs[0];
    const problem = validateCompositionJob(job);
    if (problem) throw new Error(problem);
    for (const clip of job.clips) {
      const problem = sourceProblem(
        { sizeBytes: null, mtimeMs: null, ...clip.source_identity, path: clip.input_path },
        pathSecurity,
      );
      if (problem) throw new Error(problem);
    }
    for (const overlay of job.overlays ?? []) {
      if (overlay.kind !== "image") continue;
      const problem = sourceProblem(overlay.source, pathSecurity, "image");
      if (problem) throw new Error(problem);
    }
    const binaries = validateMediaBinaries();
    if (!binaries.ok) throw new Error(binaries.error);
    const spawnSpec = await validateProcessorAvailableAsync();
    if (!isProcessingPreparationCurrent(preparation)) return { success: false, cancelled: true };
    if (!spawnSpec.ok) throw new Error(spawnSpec.error);
    return { success: true, spawnSpec, job, manifest, preparation };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function renderTo(ready, output, kind, pathSecurity) {
  try {
    if (!isProcessingPreparationCurrent(ready.preparation))
      return { success: false, cancelled: true };
    const outputDirectory = path.dirname(output);
    const jobs = await sanitizeBatchJobMedia(
      [{ ...ready.job, output_path: output }],
      pathSecurity,
      { outputDirectory },
    );
    await validateBatchOutputPaths(jobs);
    if (!isProcessingPreparationCurrent(ready.preparation))
      return { success: false, cancelled: true };
    const result = await executeProcessingRun({
      manifest: ready.manifest,
      jobs,
      outputDirectory,
      spawnSpec: ready.spawnSpec,
      owner: `editor:${kind}`,
      events:
        kind === "export" ? { [IPC_EVENTS.onJobProgress]: IPC_EVENTS.onEditorExportProgress } : {},
    });
    return result.success
      ? { ...result, path: result.outputs.find(({ index }) => index === jobs[0].id).output }
      : result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function sourceProblem(source, pathSecurity, kind = "video") {
  const check = pathSecurity.validateReadableFile(source.path, kind);
  if (!check.ok) return `No se puede leer ${path.basename(source.path)}: ${check.error}`;
  if (identityChanged(source, fs.statSync(check.resolvedPath))) {
    return `${path.basename(source.path)} cambió desde que se importó. Vuelve a importarlo.`;
  }
  return null;
}
