import {
  COMPOSITION_TYPE,
  COMPOSITION_VERSION,
  parseCompositionDocument,
} from "../../../shared/composition-document.js";
import { JOB_MANIFEST_TYPE, JOB_MANIFEST_VERSION } from "../../../shared/job-manifest.js";
import { normalizeOverlayStyle } from "../../../shared/overlay-style.js";
import { normalizeClipTransform } from "../../../shared/clip-transform.js";
import { layoutTrack } from "../../../shared/editor-timeline.js";
import { compositionJob } from "../../utils/composition.js";

const sourceIdentity = (asset) => ({
  sizeBytes: asset.sizeBytes ?? null,
  mtimeMs: asset.mtimeMs ?? null,
});

export function compileEditorComposition(project, { audio = "original" } = {}) {
  if (!["original", "silence"].includes(audio)) throw new Error("Modo de audio inválido");
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const entries = layoutTrack(project).map(({ clip }) => {
    const asset = assets.get(clip.assetId),
      transform = normalizeClipTransform(clip.transform);
    return {
      id: clip.id,
      item: {
        path: asset.path,
        filename: asset.filename,
        width: asset.metadata.width,
        height: asset.metadata.height,
        duration: asset.metadata.durationUs / 1e6,
        trimStart: clip.sourceInUs / 1e6,
        trimEnd: clip.sourceOutUs / 1e6,
        timing: { rate: clip.speed, repeatCount: 1 },
        audio: { gain: 1, muted: audio === "silence" || clip.muted === true },
        transform: { rotation: transform.rotate, flipH: transform.flipH, flipV: transform.flipV },
        framing: {
          crop: transform.crop,
          zoom: transform.zoom,
          offsetX: transform.offsetX,
          offsetY: transform.offsetY,
          fit: transform.fit === "fill" ? "cover" : "contain",
        },
        operations: [],
        sourceIdentity: sourceIdentity(asset),
      },
    };
  });
  const overlays = project.overlays.map((overlay) => {
    if (overlay.kind === "text") return { ...overlay, style: normalizeOverlayStyle(overlay.style) };
    const asset = assets.get(overlay.assetId);
    return { ...overlay, source: { path: asset.path, ...sourceIdentity(asset) } };
  });
  const document = parseCompositionDocument({
    type: COMPOSITION_TYPE,
    version: COMPOSITION_VERSION,
    canvas: { ...project.canvas, fit: "contain" },
    fps: project.fps.num / project.fps.den,
    outputName: project.name,
    entries,
    overlays,
  });
  if (!document) throw new Error("La composición contiene datos de medios o ajustes inválidos");
  return document;
}

export function buildCompositionManifest(project, { encodeProfile = "balanced", ...options } = {}) {
  const document = compileEditorComposition(project, options);
  const job = compositionJob(document, { outputPath: null, encodeProfile });
  return { type: JOB_MANIFEST_TYPE, version: JOB_MANIFEST_VERSION, jobs: job ? [job] : [] };
}

export function buildExactFrameManifest(project, timeUs, options = {}) {
  const manifest = buildCompositionManifest(project, options);
  return { ...manifest, jobs: manifest.jobs.map((job) => ({ ...job, frame: { atUs: timeUs } })) };
}
