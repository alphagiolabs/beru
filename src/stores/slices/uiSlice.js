const MODAL_PRIORITY = [
  "showCompositionModal",
  "showStabilizationModal",
  "confirmDialog",
  "showPetPalette",
  "showSettings",
  "updateModalOpen",
  "showWatermarkModal",
  "showMappingModal",
  "showTableEditor",
  "showShortcuts",
];

export const selectTopmostModal = (state) => MODAL_PRIORITY.find((key) => state[key]) ?? null;

export function createUiSlice(set, get) {
  return {
    showShortcuts: false,
    showSettings: false,
    settingsTab: "appearance",
    updateModalOpen: false,
    showStabilizationModal: false,
    isDragging: false,
    appToast: null,
    confirmDialog: null,

    closeTopmostModal: () => {
      const state = get();
      switch (selectTopmostModal(state)) {
        case "showSettings":
          return state.setShowSettings(false);
        case "updateModalOpen":
          return state.setUpdateModalOpen(false);
        case "showWatermarkModal":
          return state.setShowWatermarkModal(false);
        case "showMappingModal":
          return state.setShowMappingModal(false);
        case "showTableEditor":
          return state.setShowTableEditor(false);
        case "showShortcuts":
          return state.setShowShortcuts(false);
      }
    },

    showToast: (toast) => set({ appToast: toast }),
    clearAppToast: () => set({ appToast: null }),

    requestConfirm: ({
      title = "",
      message = "",
      confirmLabel,
      cancelLabel,
      variant = "default",
    } = {}) =>
      new Promise((resolve) => {
        const { confirmDialog } = get();
        if (confirmDialog?.resolve) confirmDialog.resolve(false);
        set({
          confirmDialog: {
            title,
            message,
            confirmLabel,
            cancelLabel,
            variant,
            resolve,
          },
        });
      }),

    resolveConfirm: (confirmed) => {
      const { confirmDialog } = get();
      confirmDialog?.resolve?.(!!confirmed);
      set({ confirmDialog: null });
    },

    setShowShortcuts: (val) => set({ showShortcuts: val }),
    setShowSettings: (val) => set({ showSettings: val }),
    setSettingsTab: (tab) => set({ settingsTab: tab }),
    openSettingsTab: (tab = "appearance") => {
      get().setShowPetPalette?.(false);
      set({ showSettings: true, settingsTab: tab });
    },
    setUpdateModalOpen: (val) => set({ updateModalOpen: val }),
    setShowStabilizationModal: (show) => set({ showStabilizationModal: show }),
    setIsDragging: (val) => set({ isDragging: val }),
  };
}
