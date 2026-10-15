export const FIT_MODES = ["pad", "stretch", "crop"];
export const OUTPUT_SIZE_MIN = 16;
export const OUTPUT_SIZE_MAX = 8192;

export const IDENTITY_TRANSFORM = Object.freeze({
  rotation: 0,
  flipH: false,
  flipV: false,
  outputHeight: null,
  outputWidth: null,
  fitMode: "pad",
});

const outputSize = (value, min = 1) =>
  Number.isInteger(value) && value >= min && value <= OUTPUT_SIZE_MAX ? value : null;

export function normalizeTransform(value) {
  const rotation = [0, 90, 180, 270].includes(Number(value?.rotation)) ? Number(value.rotation) : 0;
  const outputHeight = outputSize(value?.outputHeight);
  const outputWidth =
    outputHeight === null ? null : outputSize(value?.outputWidth, OUTPUT_SIZE_MIN);
  return {
    rotation,
    flipH: value?.flipH === true,
    flipV: value?.flipV === true,
    outputHeight: outputWidth === null ? outputHeight : Math.max(OUTPUT_SIZE_MIN, outputHeight),
    outputWidth,
    fitMode: FIT_MODES.includes(value?.fitMode) ? value.fitMode : "pad",
  };
}

export function transformJobFields(value) {
  const t = normalizeTransform(value);
  return {
    rotation: t.rotation,
    flip_h: t.flipH,
    flip_v: t.flipV,
    output_height: t.outputHeight,
    output_width: t.outputWidth,
    fit_mode: t.fitMode,
  };
}
