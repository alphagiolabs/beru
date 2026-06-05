const MAX_PROCESSING_LOG_LINES = 200;

export function appendProcessingLog(lines, line, limit = MAX_PROCESSING_LOG_LINES) {
  const nextLine = typeof line === "string" ? line : JSON.stringify(line);
  return [...(Array.isArray(lines) ? lines : []), nextLine].slice(-limit);
}

export function formatProcessingLogs(lines, meta = {}) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const header = [
    "Beru processing log",
    `Exported: ${meta.exportedAt || new Date().toISOString()}`,
    meta.summary ? `Summary: ${meta.summary}` : null,
    "",
  ].filter((line) => line !== null);
  return [...header, ...safeLines].join("\n");
}
