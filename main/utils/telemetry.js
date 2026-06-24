/**
 * Minimal telemetry stub for Beru.
 *
 * This is a local-only telemetry collector that logs usage events to a JSON
 * file in userData. It is NOT remote telemetry — no data leaves the machine.
 * A future enhancement can add opt-in remote reporting via an API endpoint.
 *
 * Events are buffered and flushed periodically to minimize I/O.
 * Disabled in dev mode.
 */

import { app } from "electron";
import fs from "fs";
import path from "path";

const TELEMETRY_FILE = "telemetry.jsonl";
const FLUSH_INTERVAL_MS = 60_000;
const MAX_BUFFER_SIZE = 100;

let buffer = [];
let flushTimer = null;
let initialized = false;
// Bound reference so init/disable always (un)register the same listener and we
// don't accumulate a new before-quit handler on each disable→init cycle.
const onBeforeQuitFlush = () => flush();

function getTelemetryPath() {
  try {
    return path.join(app.getPath("userData"), TELEMETRY_FILE);
  } catch {
    return null;
  }
}

function flush() {
  if (buffer.length === 0) return;
  const filePath = getTelemetryPath();
  if (!filePath) return;
  const lines = buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
  buffer = [];
  try {
    fs.appendFileSync(filePath, lines, "utf-8");
  } catch {
    // Telemetry must never disrupt the app — swallow errors
  }
}

/**
 * Record a usage event. Safe to call at any time — no-ops in dev mode.
 * @param {string} event - event name (e.g. "batch_complete", "preset_apply")
 * @param {object} [data] - optional event metadata
 */
export function track(event, data = {}) {
  if (!initialized || app.isPackaged === false) return;
  buffer.push({
    event,
    data,
    timestamp: new Date().toISOString(),
    version: app.getVersion(),
  });
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush();
  }
}

/**
 * Initialize the telemetry collector. Call once after app is ready.
 * Safe to call multiple times.
 */
export function initTelemetry() {
  if (initialized) return;
  initialized = true;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  flushTimer.unref();
  // Flush on quit (removed in disableTelemetry to avoid listener accumulation)
  app.on("before-quit", onBeforeQuitFlush);
}

/**
 * Disable telemetry and flush any buffered events.
 */
export function disableTelemetry() {
  if (!initialized) return;
  initialized = false;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  app.off("before-quit", onBeforeQuitFlush);
  flush();
}
