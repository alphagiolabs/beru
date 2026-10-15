import { COMPOSITION_LIMITS } from "../../../shared/composition-settings.js";
import { useT } from "../../i18n/useT";
import DraftField from "./DraftField.jsx";

export default function CanvasFields({ canvas, onSize }) {
  const t = useT();
  return (
    <>
      <DraftField
        label={t("editor.canvasWidth")}
        value={String(canvas.width)}
        min={COMPOSITION_LIMITS.minCanvasDimension}
        max={COMPOSITION_LIMITS.maxCanvasDimension}
        step={2}
        onCommit={(width) => onSize(width, canvas.height)}
      />
      <DraftField
        label={t("editor.canvasHeight")}
        value={String(canvas.height)}
        min={COMPOSITION_LIMITS.minCanvasDimension}
        max={COMPOSITION_LIMITS.maxCanvasDimension}
        step={2}
        onCommit={(height) => onSize(canvas.width, height)}
      />
    </>
  );
}
