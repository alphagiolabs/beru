export function requireWindows() {
  if (process.platform !== "win32") throw new Error("Beru solo admite Windows.");
}
