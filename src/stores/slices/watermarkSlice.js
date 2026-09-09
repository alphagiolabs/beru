export function createWatermarkSlice(set, get) {
  return {
    watermark: {
      enabled: false,
      type: "text",
      text: "",
      imagePath: "",
      imageDataUrl: "",
      opacity: 0.5,
      scale: 1,
      position: "bottom-right",
      fontSize: 18,
      fontColor: "#ffffff",
      fontFamily: "Arial",
    },
    showWatermarkModal: false,

    setShowWatermarkModal: (val) => set({ showWatermarkModal: !!val }),

    setWatermark: (patch) => set((s) => ({ watermark: { ...s.watermark, ...patch } })),
  };
}
