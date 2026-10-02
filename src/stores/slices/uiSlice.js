export function createUiSlice(set, get) {
  return {
    showShortcuts: false,
    showSettings: false,
    settingsTab: "appearance",
    updateModalOpen: false,
    isDragging: false,
    appToast: null,
    confirmDialog: null,

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
    setIsDragging: (val) => set({ isDragging: val }),
  };
}
