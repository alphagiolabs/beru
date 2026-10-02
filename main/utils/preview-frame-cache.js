import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  renderPreviewFrame as renderWorkerFrame,
  renderSourceFrame as renderWorkerSourceFrame,
  disposePreviewFrameWorker as disposeWorker,
} from "./preview-frame.js";
import { runMediaTask } from "./media-task-pool.js";

const MAX_FRAMES = 32;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const frames = new Map();
const inFlight = new Map();
let retainedBytes = 0;
let generation = 0;

async function frameKey(payload) {
  if (!payload?.input_path) return null;
  try {
    const signature = JSON.stringify(payload);
    if (Buffer.byteLength(signature) > MAX_REQUEST_BYTES) return null;
    const paths = new Set([payload.input_path]);
    for (const operation of payload.operations || []) {
      if (operation.image_path) paths.add(operation.image_path);
      if (operation.delogo_image_path) paths.add(operation.delogo_image_path);
    }
    if (payload.watermark?.type === "image") {
      const image = payload.watermark.imagePath || payload.watermark.watermark_image;
      if (image) paths.add(image);
    }
    const files = await Promise.all(
      [...paths].map(async (filePath) => {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error("Preview media is not a file");
        return [filePath, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
      }),
    );
    return createHash("sha256").update(signature).update(JSON.stringify(files)).digest("hex");
  } catch {
    return null;
  }
}

function remember(key, result) {
  if (result?.ok !== true || typeof result.data_url !== "string" || !result.data_url) return;
  const bytes = 2 * JSON.stringify(result).length + 2 * key.length;
  if (bytes > MAX_BYTES) return;
  while (frames.size >= MAX_FRAMES || retainedBytes + bytes > MAX_BYTES) {
    const oldest = frames.keys().next().value;
    retainedBytes -= frames.get(oldest).bytes;
    frames.delete(oldest);
  }
  frames.set(key, { result: { ...result }, bytes });
  retainedBytes += bytes;
}

async function renderFrame(payload, render) {
  const epoch = generation;
  const key = await frameKey(payload);
  if (epoch !== generation) return { ok: false, cancelled: true, error: "Preview cancelado" };
  if (key) {
    const hit = frames.get(key);
    if (hit) {
      frames.delete(key);
      frames.set(key, hit);
      return { ...hit.result };
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const request = runMediaTask(
    () =>
      epoch === generation
        ? render(payload)
        : { ok: false, cancelled: true, error: "Preview cancelado" },
    { interactive: true },
  )
    .then(async (result) => {
      if (key && epoch === generation && result?.ok && result.data_url) {
        const currentKey = await frameKey(payload);
        if (epoch === generation && currentKey === key) remember(key, result);
      }
      return result;
    })
    .finally(() => {
      if (key && inFlight.get(key) === request) inFlight.delete(key);
    });
  if (key) inFlight.set(key, request);
  return request;
}

export function renderPreviewFrame(payload) {
  return renderFrame(payload, renderWorkerFrame);
}

export function renderSourceFrame(payload) {
  return renderFrame({ ...payload, source_only: true }, renderWorkerSourceFrame);
}

export function disposePreviewFrameWorker() {
  generation += 1;
  frames.clear();
  retainedBytes = 0;
  inFlight.clear();
  disposeWorker();
}
