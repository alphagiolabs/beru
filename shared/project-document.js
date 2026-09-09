export const PROJECT_TYPE = "beru-project";
export const PRESET_TYPE = "beru-preset";
export const PROJECT_VERSION = "1.3.0";
export const COMPATIBLE_PROJECT_VERSIONS = new Set(["1.2.0", PROJECT_VERSION]);

export function isProjectOrPreset(data) {
  return Boolean(data && (data.type === PROJECT_TYPE || data.type === PRESET_TYPE));
}

function isQueueItem(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.path !== "string" || !item.path.trim()) return false;
  if (typeof item.filename !== "string" || !item.filename.trim()) return false;
  if (item.operations && !Array.isArray(item.operations)) return false;
  return true;
}

export function validateProjectDocument(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "El proyecto debe ser un objeto" };
  }
  if (!isProjectOrPreset(data)) {
    return { valid: false, error: "Tipo de documento inválido" };
  }
  if (typeof data.version !== "string" || !data.version.trim()) {
    return { valid: false, error: "Campo requerido faltante: version" };
  }
  if (data.queue !== undefined) {
    if (!Array.isArray(data.queue)) {
      return { valid: false, error: "queue debe ser un array" };
    }
    for (let i = 0; i < data.queue.length; i++) {
      if (!isQueueItem(data.queue[i])) {
        return { valid: false, error: `Item de queue inválido en posición ${i}` };
      }
    }
  }
  return { valid: true };
}
