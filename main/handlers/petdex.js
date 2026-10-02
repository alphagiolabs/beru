import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";
import {
  fetchPetManifest,
  installPet,
  resolveBundledSpritesheetPath,
  resolvePetSpritesheetPath,
} from "../utils/petdex.js";
import { listInstalledPets } from "../utils/petdex-fs.js";

export function registerPetdexHandlers() {
  handleIpc(IPC_INVOKE.fetchPetManifest, async () => {
    const result = await fetchPetManifest();
    return { success: true, manifest: result.manifest, source: result.source };
  });

  handleIpc(IPC_INVOKE.listInstalledPets, async () => ({
    success: true,
    pets: listInstalledPets(),
  }));

  handleIpc(IPC_INVOKE.installPet, async (_event, entry) => {
    const pet = await installPet(entry);
    return { success: true, pet };
  });

  handleIpc(IPC_INVOKE.getPetSpritesheet, async (_event, slug) => {
    const filePath = resolvePetSpritesheetPath(slug);
    return { success: true, path: filePath };
  });

  handleIpc(IPC_INVOKE.getBundledSpritesheet, async (_event, slug) => {
    const filePath = resolveBundledSpritesheetPath(slug);
    return { success: true, path: filePath };
  });
}
