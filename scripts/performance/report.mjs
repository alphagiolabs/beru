const CLOSED_MODULES = new Set([
  "src/components/ShortcutsModal.jsx",
  "src/components/TableEditor.jsx",
  "src/components/ExcelMappingModal.jsx",
  "src/components/WatermarkModal.jsx",
  "src/components/SettingsModal.jsx",
  "src/components/PropertiesPanel.jsx",
  "src/components/LayerList.jsx",
  "src/components/settings/AppearancePanel.jsx",
  "src/components/settings/ThemeEditor.jsx",
  "src/components/settings/UserManagementPanel.jsx",
  "src/features/pets/settings/PetdexPanel.jsx",
  "src/features/pets/components/PetPaletteModal.jsx",
  "src/features/pets/components/DesktopPet.jsx",
  "src/features/pets/components/PetSurface.jsx",
]);

export function summarize(values) {
  if (values.length === 0) return null;
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Performance samples must be finite numbers");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => {
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
  };
  return {
    count: sorted.length,
    min: sorted[0],
    median: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  };
}

export function checkStartupPanels(requests, chunks) {
  const names = new Set(requests.map((url) => new URL(url).pathname.split("/").pop()));
  return chunks.flatMap((chunk) =>
    names.has(chunk.file.split("/").pop())
      ? chunk.modules
          .filter((module) => CLOSED_MODULES.has(module))
          .map((module) => ({ file: chunk.file, module }))
      : [],
  );
}

export function summarizeRuns(runs) {
  const groups = new Map();
  for (const run of runs.filter((run) => !run.failure)) {
    for (const phase of run.phases) {
      const group = groups.get(phase.name) || [];
      group.push(phase);
      groups.set(phase.name, group);
    }
  }
  return Object.fromEntries(
    [...groups].map(([name, phases]) => [
      name,
      {
        elapsedMs: summarize(phases.map((phase) => phase.elapsedMs)),
        availableMemoryMinBytes: summarize(
          phases.map((phase) => Math.min(...phase.samples.map((sample) => sample.availableBytes))),
        ),
        electronWorkingSetPeakBytes: summarize(
          phases.map((phase) => Math.max(...phase.samples.map((sample) => sample.workingSetBytes))),
        ),
        rendererHeapEndBytes: summarize(phases.map((phase) => phase.heapBytes)),
        frameIntervalMs: summarize(phases.flatMap((phase) => phase.frames)),
        previewRequestMs: summarize(phases.flatMap((phase) => phase.action?.elapsedMs || [])),
      },
    ]),
  );
}
