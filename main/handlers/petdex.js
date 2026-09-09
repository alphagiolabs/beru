import { ipcMain } from "electron";
import {
  fetchPetManifest,
  installPet,
  listInstalledPets,
  resolveBundledSpritesheetPath,
  resolvePetSpritesheetPath,
  uninstallPet,
} from "../utils/petdex.js";

function wrapPetdex(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  };
}

export function registerPetdexHandlers() {
  ipcMain.handle(
    "petdex:fetchManifest",
    wrapPetdex(async () => {
      const result = await fetchPetManifest();
      return { success: true, manifest: result.manifest, source: result.source };
    }),
  );

  ipcMain.handle(
    "petdex:listInstalled",
    wrapPetdex(async () => ({ success: true, pets: listInstalledPets() })),
  );

  ipcMain.handle(
    "petdex:install",
    wrapPetdex(async (_event, entry) => {
      const pet = await installPet(entry);
      return { success: true, pet };
    }),
  );

  ipcMain.handle(
    "petdex:uninstall",
    wrapPetdex(async (_event, slug) => {
      const pet = uninstallPet(slug);
      return { success: true, pet };
    }),
  );

  ipcMain.handle(
    "petdex:getSpritesheet",
    wrapPetdex(async (_event, slug) => {
      const filePath = resolvePetSpritesheetPath(slug);
      return { success: true, path: filePath };
    }),
  );

  ipcMain.handle(
    "petdex:getBundledSpritesheet",
    wrapPetdex(async (_event, slug) => {
      const filePath = resolveBundledSpritesheetPath(slug);
      return { success: true, path: filePath };
    }),
  );
}
