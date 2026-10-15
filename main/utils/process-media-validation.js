import path from "path";
import { deriveOutputPath } from "./process-output.js";
import { runWithConcurrency } from "./concurrency.js";
import { jobMediaSources } from "../../shared/job-manifest.js";

export async function sanitizeBatchJobMedia(jobs, pathSecurity, options) {
  const checks = new Map();
  const key = (filePath, kind) => `${kind}\u0000${filePath}`;
  const add = (filePath, kind) => checks.set(key(filePath, kind), [filePath, kind]);
  for (const job of jobs) {
    for (const source of jobMediaSources(job)) add(source.path, source.kind);
  }
  await runWithConcurrency([...checks.entries()], 8, async ([id, [filePath, kind]]) => {
    checks.set(id, await pathSecurity.validateReadableFileAsync(filePath, kind));
  });
  const cachedSecurity = {
    validateReadableFile: (filePath, kind) => checks.get(key(filePath, kind)),
  };
  return jobs.map((job) => sanitizeJobMedia(job, cachedSecurity, options));
}

export function sanitizeJobMedia(job, pathSecurity, { outputDirectory } = {}) {
  if (job?.kind === "composition") {
    return {
      ...job,
      clips: job.clips.map((clip) => sanitizeJobMedia(clip, pathSecurity)),
      ...(job.overlays
        ? {
            overlays: job.overlays.map((overlay) => {
              if (overlay.kind !== "image") return overlay;
              const check = pathSecurity.validateReadableFile(overlay.source.path, "image");
              if (!check.ok) throw new Error(`Imagen no permitida: ${check.error}`);
              return {
                ...overlay,
                source: { ...overlay.source, path: check.resolvedPath },
                source_root: path.dirname(check.resolvedPath),
              };
            }),
          }
        : {}),
      ...(outputDirectory != null
        ? {
            output_path: deriveOutputPath(outputDirectory, job.output_path, {
              frame: job.frame != null,
            }),
            output_root: outputDirectory,
          }
        : {}),
    };
  }
  const inputCheck = pathSecurity.validateReadableFile(job?.input_path, "video");
  if (!inputCheck.ok) {
    throw new Error(`Entrada no permitida: ${inputCheck.error}`);
  }

  const assetRoots = new Set();
  const validateImage = (imagePath) => {
    if (!imagePath) return imagePath;
    const imageCheck = pathSecurity.validateReadableFile(imagePath, "image");
    if (!imageCheck.ok) {
      throw new Error(`Imagen no permitida: ${imageCheck.error}`);
    }
    assetRoots.add(path.dirname(imageCheck.resolvedPath));
    return imageCheck.resolvedPath;
  };

  const operations = (job.operations || []).map((operation) => ({
    ...operation,
    image_path: validateImage(operation.image_path),
    delogo_image_path: validateImage(operation.delogo_image_path),
  }));
  let externalAudio = job.external_audio ? { ...job.external_audio } : null;
  if (externalAudio) {
    const check = pathSecurity.validateReadableFile(externalAudio.path, "audio");
    if (!check.ok) throw new Error(`Audio no permitido: ${check.error}`);
    externalAudio.path = check.resolvedPath;
    assetRoots.add(path.dirname(check.resolvedPath));
  }
  const watermark = job.watermark ? { ...job.watermark } : null;
  if (watermark?.type === "image") {
    watermark.imagePath = validateImage(watermark.imagePath || watermark.watermark_image);
  }

  const sanitized =
    job.kind === "stabilization"
      ? {
          ...job,
          input_path: inputCheck.resolvedPath,
          input_root: path.dirname(inputCheck.resolvedPath),
        }
      : {
          ...job,
          input_path: inputCheck.resolvedPath,
          input_root: path.dirname(inputCheck.resolvedPath),
          asset_roots: [...assetRoots],
          operations,
          watermark,
          external_audio: externalAudio,
        };

  if (outputDirectory != null) {
    sanitized.output_path = deriveOutputPath(outputDirectory, job.output_path);
    sanitized.output_root = outputDirectory;
  }

  return sanitized;
}
