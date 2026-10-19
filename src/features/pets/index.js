import { lazy } from "react";
import usePetKeyboard from "./hooks/usePetKeyboard.js";
import "./pets.css";

export const DesktopPet = lazy(() => import("./components/DesktopPet.jsx"));

export { usePetKeyboard };
