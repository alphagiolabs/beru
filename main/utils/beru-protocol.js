export function filePathFromBeruUrl(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== "beru:" || url.hostname !== "local") return null;

  const decoded = decodeURIComponent(url.pathname || "");
  if (!decoded) return null;

  if (process.platform === "win32" && /^\/[A-Za-z]:[\\/]/.test(decoded)) {
    return decoded.slice(1);
  }
  if (decoded.startsWith("//")) {
    return decoded.slice(1);
  }
  return decoded;
}

export function validateBeruRequestPath(pathSecurity, requestUrl) {
  const filePath = filePathFromBeruUrl(requestUrl);
  if (!filePath) return { ok: false, error: "Ruta inválida" };
  return pathSecurity.validateProtocolFile(filePath);
}
