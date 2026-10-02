import { lazyPanel } from "../utils/lazy-panel";

export const PropertiesPanel = lazyPanel(() => import("./PropertiesPanel"));
export const LayerList = lazyPanel(() => import("./LayerList"));

export function preloadEditorPanels() {
  PropertiesPanel.preload();
  LayerList.preload();
}
