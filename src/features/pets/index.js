import { lazy } from "react";
import usePetKeyboard from "./hooks/usePetKeyboard.js";
import "./pets.css";

export const DesktopPet = lazy(() => import("./components/DesktopPet.jsx"));
export const PetPaletteModal = lazy(() => import("./components/PetPaletteModal.jsx"));
export const PetdexPanel = lazy(() => import("./settings/PetdexPanel.jsx"));

export { usePetKeyboard };
