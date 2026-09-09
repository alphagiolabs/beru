import { registerPetdexHandlers } from "../handlers/petdex.js";
import { registerPetOverlayHandlers } from "../handlers/pet-overlay.js";
import { closePetOverlayWindow } from "../utils/pet-overlay.js";

export function registerPetsModule() {
  registerPetdexHandlers();
  registerPetOverlayHandlers();
}

export function disposePetsModule() {
  closePetOverlayWindow();
}
