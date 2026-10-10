import path from "path";
import { deriveOutputPath } from "./process-output.js";
import { runWithConcurrency } from "./concurrency.js";

export async function sanitizeBatchJobMedia(jobs, pathSecurity, options) {
  const checks = new Map();
  const key = (filePath, kind) => `${kind}\u0000${filePath}`;
  const add = (filePath, kind) => checks.set(key(filePath, kind), [filePath, kind]);
  for (const job of jobs) {
    add(job?.input_path, "video");
    for (const op of job?.operations || []) {
      for (const imagePath of [op.image_path, op.delogo_image_path]) {
        if (imagePath) add(imagePath, "image");
      }
    }
    if (job?.watermark?.type === "image") {
      const imagePath = job.watermark.imagePath || job.watermark.watermark_image;
      if (imagePath) add(imagePath, "image");
    }
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
  const watermark = job.watermark ? { ...job.watermark } : null;
  if (watermark?.type === "image") {
    watermark.imagePath = validateImage(watermark.imagePath || watermark.watermark_image);
  }

  const sanitized = {
    ...job,
    input_path: inputCheck.resolvedPath,
    input_root: path.dirname(inputCheck.resolvedPath),
    asset_roots: [...assetRoots],
    operations,
    watermark,
  };

  if (outputDirectory != null) {
    sanitized.output_path = deriveOutputPath(outputDirectory, job.output_path);
    sanitized.output_root = outputDirectory;
  }

  return sanitized;
}
