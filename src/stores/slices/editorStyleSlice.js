import { patchToGlobalState } from "../../utils/text-style";

/** Active tool, sidebar mode, text/blur/delogo defaults, and style setters. */
export function createEditorStyleSlice(set, get) {
  return {
    activeTool: "blur",
    sidebarMode: "logo",

    textInput: "Sample Text",
    textFontSize: 32,
    textFontColor: "white",
    fontFamily: "Arial",
    fontWeight: 400,
    letterSpacing: 0,
    textAlign: "left",
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: true,
    bgColor: "black",
    bgOpacity: 0.65,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    blurStrength: 20,
    delogoMethod: "temporal",
    delogoFillColor: "black",
    delogoFillOpacity: 1,
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
      const stylePatch = {
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontColor: preset.fontColor,
        bold: preset.bold,
        italic: preset.italic,
        bgEnabled: preset.bgEnabled,
        bgColor: preset.bgColor,
        bgOpacity: preset.bgOpacity,
        borderWidth: preset.borderWidth,
        borderColor: preset.borderColor,
      };
      if (get().sidebarMode === "batch") {
        get().patchBatchTextStyle(stylePatch);
      } else {
        set(patchToGlobalState(stylePatch));
      }
    },

    setDelogoMethod: (val) => set({ delogoMethod: val }),
    setDelogoFillColor: (val) => set({ delogoFillColor: val }),
    setDelogoFillOpacity: (val) => set({ delogoFillOpacity: Number(val) }),
    setTemporalRadius: (val) => set({ temporalRadius: Number(val) }),
    setMosaicSize: (val) => set({ mosaicSize: Number(val) }),
    setMirrorSide: (val) => set({ mirrorSide: val }),
    setEdgeFeather: (val) => set({ edgeFeather: Number(val) }),
    setTextInput: (val) => set({ textInput: val }),
    setTextFontSize: (val) => set({ textFontSize: Number(val) }),
    setTextFontColor: (val) => set({ textFontColor: val }),
    setFontFamily: (val) => set({ fontFamily: val }),
    setFontWeight: (val) => set({ fontWeight: Number(val) }),
    setLetterSpacing: (val) => set({ letterSpacing: Number(val) }),
    setTextAlign: (val) => set({ textAlign: val }),
    setTextOpacity: (val) => set({ textOpacity: Number(val) }),
    setBoxBorderWidth: (val) => set({ boxBorderWidth: Number(val) }),
    setBold: (val) => set({ bold: val }),
    setItalic: (val) => set({ italic: val }),
    setBgEnabled: (val) => set({ bgEnabled: val }),
    setBgColor: (val) => set({ bgColor: val }),
    setBgOpacity: (val) => set({ bgOpacity: Number(val) }),
    setBorderWidth: (val) => set({ borderWidth: Number(val) }),
    setBorderColor: (val) => set({ borderColor: val }),
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
      }
      set({ sidebarMode: val });
    },
    setOutputDir: (dir) => set({ outputDir: dir || null }),
  };
}
