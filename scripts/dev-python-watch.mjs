const RUNTIME_PROCESSOR_MODULES = new Set([
  "processor.py",
  "batch_context.py",
  "batch_errors.py",
  "capacity.py",
  "color_validation.py",
  "delogo_chains.py",
  "encode_args.py",
  "encode_profiles.py",
  "encoders.py",
  "ffmpeg_runner.py",
  "filters.py",
  "fonts.py",
  "job_classify.py",
  "media_paths.py",
  "media_probe.py",
  "op_shared.py",
  "preview.py",
  "temporal_motion.py",
  "temporal_pipeline.py",
  "spatial_inpaint.py",
  "text_layout_helpers.py",
]);

export function shouldRestartElectronForPythonChange(filename) {
  if (!filename || typeof filename !== "string") return false;
  const base = filename.split(/[/\\]/).pop();
  return RUNTIME_PROCESSOR_MODULES.has(base);
}
