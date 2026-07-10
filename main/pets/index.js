import { registerPetdexHandlers } from "../handlers/petdex.js";
import { registerPetOverlayHandlers } from "../handlers/pet-overlay.js";
import { closePetOverlayWindow } from "../utils/pet-overlay.js";

/** Single entry point for pets IPC + overlay lifecycle from main.js. */
export function registerPetsModule() {
  registerPetdexHandlers();
  registerPetOverlayHandlers();
}

export function disposePetsModule() {
  closePetOverlayWindow();
}
