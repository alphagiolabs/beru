import { lazyPanel } from "../utils/lazy-panel";

export const ShortcutsModal = lazyPanel(() => import("./ShortcutsModal"));
export const TableEditor = lazyPanel(() => import("./TableEditor"));
export const ExcelMappingModal = lazyPanel(() => import("./ExcelMappingModal"));
export const WatermarkModal = lazyPanel(() => import("./WatermarkModal"));
export const SettingsModal = lazyPanel(() => import("./SettingsModal"));
export const PetPaletteModal = lazyPanel(
  () => import("../features/pets/components/PetPaletteModal.jsx"),
);
