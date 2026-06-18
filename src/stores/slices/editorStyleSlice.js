import { GLOBAL_TEXT_STYLE_DEFAULTS, patchToGlobalState } from "../../utils/text-style";

/** Active tool, sidebar mode, text/blur/delogo defaults, and style setters. */
export function createEditorStyleSlice(set, get) {
  return {
    activeTool: "blur",
    sidebarMode: "logo",

    ...GLOBAL_TEXT_STYLE_DEFAULTS,
    blurStrength: 20,
    delogoMethod: "temporal",
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
      const stylePatch = {
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontColor: preset.fontColor,
        fontWeight: preset.fontWeight,
        letterSpacing: preset.letterSpacing,
        textAlign: preset.textAlign,
        textOpacity: preset.textOpacity,
        bold: preset.bold,
        italic: preset.italic,
        bgEnabled: preset.bgEnabled,
        bgColor: preset.bgColor,
        bgOpacity: preset.bgOpacity,
        boxBorderWidth: preset.boxBorderWidth,
        borderWidth: preset.borderWidth,
        borderColor: preset.borderColor,
        textShadowEnabled: preset.textShadowEnabled,
        textShadowColor: preset.textShadowColor,
        textShadowOffsetX: preset.textShadowOffsetX,
        textShadowOffsetY: preset.textShadowOffsetY,
        autoFit: preset.autoFit,
        lineHeight: preset.lineHeight,
        verticalAlign: preset.verticalAlign,
        textWrap: preset.textWrap,
        safeMargin: preset.safeMargin,
        truncate: preset.truncate,
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
    setDelogoImagePath: (val) => set({ delogoImagePath: val || "" }),
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
    setTextShadowEnabled: (val) => set({ textShadowEnabled: !!val }),
    setTextShadowColor: (val) => set({ textShadowColor: val }),
    setTextShadowOffsetX: (val) => set({ textShadowOffsetX: Number(val) }),
    setTextShadowOffsetY: (val) => set({ textShadowOffsetY: Number(val) }),
    setAutoFit: (val) => set({ autoFit: !!val }),
    setLineHeight: (val) => set({ lineHeight: Number(val) }),
    setVerticalAlign: (val) => set({ verticalAlign: val }),
    setTextWrap: (val) => set({ textWrap: !!val }),
    setSafeMargin: (val) => set({ safeMargin: Number(val) }),
    setTruncate: (val) => set({ truncate: val }),
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
