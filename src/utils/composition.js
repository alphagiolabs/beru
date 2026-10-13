import {
  parseCompositionDocument,
  compositionItem,
  COMPOSITION_TYPE,
  COMPOSITION_VERSION,
  COMPOSITION_JOB_ID,
} from "../../shared/composition-document.js";
import { buildExportJob } from "./export-pipeline.js";
import { outputDimensions } from "./output-geometry.js";
import { frameAfterCrops } from "./crop-output.js";

export { parseCompositionDocument, compositionItem };
export function newComposition(item) {
  const size = outputDimensions(
    frameAfterCrops(item.operations, {
      w: item.sourceWidth || item.width,
      h: item.sourceHeight || item.height,
    }),
    item.transform,
  );
  return {
    type: COMPOSITION_TYPE,
    version: COMPOSITION_VERSION,
    canvas: {
      width: Math.max(16, Math.min(4096, Math.floor((size.width || 1280) / 2) * 2)),
      height: Math.max(16, Math.min(4096, Math.floor((size.height || 720) / 2) * 2)),
      fit: "contain",
    },
    fps: [24, 25, 30, 50, 60].includes(item?.frameRate) ? item.frameRate : 30,
    outputName: "composition",
    entries: [],
  };
}
export function compositionJob(document, { outputPath, encodeProfile = "balanced" }) {
  const composition = parseCompositionDocument(document);
  if (!composition || composition.entries.length < 2) return null;
  const clips = composition.entries.map((entry, index) =>
    buildExportJob(entry.item, index, { outputPath: null, encodeProfile }),
  );
  if (clips.some((clip) => !clip)) return null;
  return {
    id: COMPOSITION_JOB_ID,
    kind: "composition",
    output_path: outputPath,
    encode_profile: encodeProfile,
    clips,
    canvas: composition.canvas,
    composition_fps: composition.fps,
  };
}
