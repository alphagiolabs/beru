export function restoreSessionPaths(pathSecurity, payload = {}) {
  const result = {
    ok: true,
    outputDir: null,
    videos: 0,
    images: 0,
    excel: false,
    errors: [],
    audio: 0,
  };
  if (payload?.outputDir) {
    const check = pathSecurity.registerOutputDirectory(payload.outputDir);
    if (check.ok) result.outputDir = check.resolvedPath;
    else result.errors.push(check.error || "outputDir");
  }
  for (const [field, kind, count] of [
    ["videoPaths", "video", "videos"],
    ["imagePaths", "image", "images"],
    ["audioPaths", "audio", "audio"],
  ]) {
    for (const mediaPath of Array.isArray(payload?.[field]) ? payload[field] : []) {
      const check = pathSecurity.registerAllowedPath(mediaPath, kind);
      if (check.ok) result[count] += 1;
      else result.errors.push(check.error || mediaPath);
    }
  }
  if (payload?.excelPath) {
    const check = pathSecurity.registerAllowedPath(payload.excelPath, "excel");
    if (check.ok) result.excel = true;
    else result.errors.push(check.error || "excel");
  }
  return result;
}
