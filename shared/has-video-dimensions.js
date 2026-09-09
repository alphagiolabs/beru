export function hasVideoDimensions(item) {
  return Number(item?.width || 0) > 0 && Number(item?.height || 0) > 0;
}
