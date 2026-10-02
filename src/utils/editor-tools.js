import { Droplet, Crop, Type, Eraser, Image, Hand } from "lucide-react";

export const EDITOR_TOOLS = [
  { id: "pan", icon: Hand, labelKey: "toolbar.pan" },
  { id: "blur", icon: Droplet, labelKey: "toolbar.blur" },
  { id: "crop", icon: Crop, labelKey: "toolbar.crop" },
  { id: "text", icon: Type, labelKey: "toolbar.text" },
  { id: "image", icon: Image, labelKey: "toolbar.image" },
  { id: "delogo", icon: Eraser, labelKey: "toolbar.delogo" },
];

export const TOOL_COLORS = {
  pan: "var(--text-secondary)",
  blur: "var(--accent)",
  crop: "var(--amber)",
  text: "var(--purple)",
  image: "#10b981",
  delogo: "var(--rose)",
};
