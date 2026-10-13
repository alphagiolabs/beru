export function createStabilizationSlice(set) {
  return {
    showStabilizationModal: false,
    setShowStabilizationModal: (show) => set({ showStabilizationModal: show }),
  };
}
