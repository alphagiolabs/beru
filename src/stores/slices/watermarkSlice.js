import { restoreWatermark } from "../../utils/sanitize-preset.js";

export function createWatermarkSlice(set) {
  return {
    watermark: restoreWatermark({}),
    showWatermarkModal: false,

    setShowWatermarkModal: (val) => set({ showWatermarkModal: !!val }),

    setWatermark: (patch) => set((s) => ({ watermark: { ...s.watermark, ...patch } })),
  };
}
