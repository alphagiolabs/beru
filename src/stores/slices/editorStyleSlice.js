import { GLOBAL_TEXT_STYLE_DEFAULTS } from "../../utils/text-style";
import { DELOGO_FIELD_BOUNDS } from "../../utils/delogo-ops";

export function createEditorStyleSlice(set, get) {
  return {
    activeTool: "blur",
    sidebarMode: "logo",

    ...GLOBAL_TEXT_STYLE_DEFAULTS,
    blurStrength: DELOGO_FIELD_BOUNDS.blurStrength.default,
    delogoMethod: "blur",
    delogoFillColor: "black",
    delogoFillOpacity: 1,
    delogoImagePath: "",
    delogoImageV: "",
    temporalRadius: DELOGO_FIELD_BOUNDS.temporalRadius.default,
    mosaicSize: DELOGO_FIELD_BOUNDS.mosaicSize.default,
    mirrorSide: "right",
    edgeFeather: DELOGO_FIELD_BOUNDS.edgeFeather.default,

    tempStart: null,
    tempEnd: null,

    tempImagePath: "",
    tempImageV: "",
    tempImageOpacity: 1,

    outputDir: null,

    setDelogoMethod: (val) => set({ delogoMethod: val }),
    setDelogoFillColor: (val) => set({ delogoFillColor: val }),
    setDelogoFillOpacity: (val) => set({ delogoFillOpacity: Number(val) }),
    setDelogoImagePath: (val, v) => set({ delogoImagePath: val || "", delogoImageV: v || "" }),
    setTemporalRadius: (val) => set({ temporalRadius: Number(val) }),
    setMosaicSize: (val) => set({ mosaicSize: Number(val) }),
    setMirrorSide: (val) => set({ mirrorSide: val }),
    setEdgeFeather: (val) => set({ edgeFeather: Number(val) }),
    setTextInput: (val) => set({ textInput: val }),
    setBlurStrength: (val) => set({ blurStrength: Number(val) }),
    setTempStart: (val) => set({ tempStart: val === null || val === "" ? null : Number(val) }),
    setTempEnd: (val) => set({ tempEnd: val === null || val === "" ? null : Number(val) }),
    setTempImagePath: (val, v) => set({ tempImagePath: val || "", tempImageV: v || "" }),
    setTempImageOpacity: (val) => set({ tempImageOpacity: Number(val) }),
    setActiveTool: (val) =>
      set({
        activeTool: val,
        currentRegion: null,
        tempImagePath: val === "image" ? get().tempImagePath : "",
        tempImageV: val === "image" ? get().tempImageV : "",
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
