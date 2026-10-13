export const IDENTITY_TRANSFORM = Object.freeze({
  rotation: 0,
  flipH: false,
  flipV: false,
  outputHeight: null,
});

export function normalizeTransform(value) {
  const rotation = [0, 90, 180, 270].includes(Number(value?.rotation)) ? Number(value.rotation) : 0;
  const outputHeight =
    Number.isInteger(value?.outputHeight) && value.outputHeight > 0 ? value.outputHeight : null;
  return { rotation, flipH: value?.flipH === true, flipV: value?.flipV === true, outputHeight };
}
