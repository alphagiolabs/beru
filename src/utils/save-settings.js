import { swallow } from "./swallow.js";

export async function saveSettingsQuietly(partial, label) {
  const api = window.api;
  if (!api?.saveSettings) return;
  try {
    await api.saveSettings(partial);
  } catch (e) {
    swallow(`saveSettings(${label})`, e);
  }
}
