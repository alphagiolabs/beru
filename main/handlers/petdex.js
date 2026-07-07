import { ipcMain } from "electron";
import {
  fetchPetManifest,
  installPet,
  listInstalledPets,
  resolveBundledSpritesheetPath,
  resolvePetSpritesheetPath,
  uninstallPet,
} from "../utils/petdex.js";

export function registerPetdexHandlers() {
  ipcMain.handle("petdex:fetchManifest", async () => {
    try {
      const result = await fetchPetManifest();
      return { success: true, manifest: result.manifest, source: result.source };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("petdex:listInstalled", async () => {
    try {
      return { success: true, pets: listInstalledPets() };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("petdex:install", async (_event, entry) => {
    try {
      const pet = await installPet(entry);
      return { success: true, pet };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("petdex:uninstall", async (_event, slug) => {
    try {
      const pet = uninstallPet(slug);
      return { success: true, pet };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("petdex:getSpritesheet", async (_event, slug) => {
    try {
      const filePath = resolvePetSpritesheetPath(slug);
      return { success: true, path: filePath };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("petdex:getBundledSpritesheet", async (_event, slug) => {
    try {
      const filePath = resolveBundledSpritesheetPath(slug);
      return { success: true, path: filePath };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });
}
