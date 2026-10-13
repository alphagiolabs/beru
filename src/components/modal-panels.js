import { lazyPanel } from "../utils/lazy-panel";

export const ShortcutsModal = lazyPanel(() => import("./ShortcutsModal"));
export const TableEditor = lazyPanel(() => import("./TableEditor"));
export const ExcelMappingModal = lazyPanel(() => import("./ExcelMappingModal"));
export const WatermarkModal = lazyPanel(() => import("./WatermarkModal"));
export const CompositionModal = lazyPanel(() => import("./CompositionModal"));
export const StabilizationModal = lazyPanel(() => import("./StabilizationModal"));
export const SettingsModal = lazyPanel(() => import("./SettingsModal"));
export const PetPaletteModal = lazyPanel(
  () => import("../features/pets/components/PetPaletteModal.jsx"),
);
