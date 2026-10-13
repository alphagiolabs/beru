export const STABILIZATION_JOB_ID = -2;
export const STABILIZATION_INTENSITIES = ["low", "medium", "high"];
export const STABILIZATION_EDGES = ["zoom", "keep"];
export const STABILIZATION_SAMPLE_SECONDS = 5;
export const STABILIZATION_DEFAULTS = Object.freeze({ intensity: "medium", edges: "zoom" });

export function parseStabilizationSettings(value) {
  return STABILIZATION_INTENSITIES.includes(value?.intensity) &&
    STABILIZATION_EDGES.includes(value?.edges)
    ? { intensity: value.intensity, edges: value.edges }
    : null;
}

export function isStabilizationJob(job) {
  return (
    job?.kind === "stabilization" &&
    job.id === STABILIZATION_JOB_ID &&
    parseStabilizationSettings(job.stabilization) !== null &&
    (job.sample_seconds == null ||
      (Number.isFinite(job.sample_seconds) && job.sample_seconds >= 1 && job.sample_seconds <= 60))
  );
}

export function stabilizationJob(item, settings, { outputPath, sample = false, encodeProfile }) {
  const parsed = parseStabilizationSettings(settings);
  if (!parsed || typeof item?.path !== "string" || !item.path.trim()) return null;
  return {
    id: STABILIZATION_JOB_ID,
    kind: "stabilization",
    input_path: item.path,
    output_path: outputPath,
    stabilization: parsed,
    sample_seconds: sample ? STABILIZATION_SAMPLE_SECONDS : null,
    encode_profile: encodeProfile || "balanced",
  };
}
