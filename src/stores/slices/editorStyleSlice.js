import {
  GLOBAL_TEXT_STYLE_DEFAULTS,
  patchToGlobalState,
  pickTextStyle,
} from "../../utils/text-style";

export function createEditorStyleSlice(set, get) {
  return {
    activeTool: "blur",
    sidebarMode: "logo",

    ...GLOBAL_TEXT_STYLE_DEFAULTS,
    blurStrength: 20,
    delogoMethod: "blur",
    delogoFillColor: "black",
    delogoFillOpacity: 1,
    delogoImagePath: "",
    temporalRadius: 3,
    mosaicSize: 12,
    mirrorSide: "right",
    edgeFeather: 6,

    tempStart: null,
    tempEnd: null,

    tempImagePath: "",
    tempImageDataUrl: "",
    tempImageOpacity: 1,
    tempImageScale: 1,

    outputDir: null,

    loadPreset: (preset) => {
      const stylePatch = pickTextStyle(preset);
      if (get().sidebarMode === "batch") {
        get().patchBatchTextStyle(stylePatch);
      } else {
        set(patchToGlobalState(stylePatch));
      }
    },

    setDelogoMethod: (val) => set({ delogoMethod: val }),
    setDelogoFillColor: (val) => set({ delogoFillColor: val }),
    setDelogoFillOpacity: (val) => set({ delogoFillOpacity: Number(val) }),
    setDelogoImagePath: (val) => set({ delogoImagePath: val || "" }),
    setTemporalRadius: (val) => set({ temporalRadius: Number(val) }),
    setMosaicSize: (val) => set({ mosaicSize: Number(val) }),
    setMirrorSide: (val) => set({ mirrorSide: val }),
    setEdgeFeather: (val) => set({ edgeFeather: Number(val) }),
    setTextInput: (val) => set({ textInput: val }),
    setBlurStrength: (val) => set({ blurStrength: Number(val) }),
    setTempStart: (val) => set({ tempStart: val === null || val === "" ? null : Number(val) }),
    setTempEnd: (val) => set({ tempEnd: val === null || val === "" ? null : Number(val) }),
    setTempImagePath: (val) => set({ tempImagePath: val || "" }),
    setTempImageDataUrl: (val) => set({ tempImageDataUrl: val || "" }),
    setTempImageOpacity: (val) => set({ tempImageOpacity: Number(val) }),
    setTempImageScale: (val) => set({ tempImageScale: Number(val) }),
    setActiveTool: (val) =>
      set({
        activeTool: val,
        currentRegion: null,
        tempImagePath: val === "image" ? get().tempImagePath : "",
        tempImageDataUrl: val === "image" ? get().tempImageDataUrl : "",
      }),
    setSidebarMode: (val) => {
      if (val === "batch") {
        const { templateRegions, selectedTemplateRegionId } = get();
        if (templateRegions.length > 0 && selectedTemplateRegionId == null) {
          get().setSelectedTemplateRegion(templateRegions[0].id);
        }
        set({ sidebarMode: val, activeTool: "text" });
        return;
      }
      set({ sidebarMode: val });
    },
    setOutputDir: (dir) => set({ outputDir: dir || null }),
  };
}
