import { create } from "zustand";
import { clampZoom, DEFAULT_PX_PER_SECOND } from "../timeline/geometry.js";

export const useEditorSession = create((set) => ({
  playhead: 0,
  playing: false,
  selectedClipId: null,
  selectedOverlayId: null,
  pxPerSecond: DEFAULT_PX_PER_SECOND,
  setPlayhead: (playhead) => set({ playhead: Math.max(0, Math.round(playhead)) }),
  setPlaying: (playing) => set({ playing }),
  selectClip: (selectedClipId) => set({ selectedClipId, selectedOverlayId: null }),
  selectOverlay: (selectedOverlayId) => set({ selectedOverlayId, selectedClipId: null }),
  setZoom: (pxPerSecond) => set({ pxPerSecond: clampZoom(pxPerSecond) }),
  reset: () => set({ playhead: 0, playing: false, selectedClipId: null, selectedOverlayId: null }),
}));
