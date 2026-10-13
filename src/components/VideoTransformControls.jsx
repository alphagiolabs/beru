import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { InspectorGroup } from "./inspector";
import { frameAfterCrops } from "../utils/crop-output";
import {
  normalizeTransform,
  outputDimensions,
  isIdentityTransform,
  IDENTITY_TRANSFORM,
} from "../utils/output-geometry";
import { getLockedDimensions } from "../utils/video-dimensions";

const HEIGHTS = [null, 1080, 720, 480];

export default function VideoTransformControls() {
  const t = useT();
  const item = useEditorStore((s) => (s.selectedIdx >= 0 ? s.queue[s.selectedIdx] : null));
  const locked = useEditorStore((s) => s.isProcessing);
  const setVideoTransform = useEditorStore((s) => s.setVideoTransform);
  if (!item) return null;

  const transform = normalizeTransform(item.transform);
  const { width, height } = getLockedDimensions(item);
  const frame = frameAfterCrops(item.operations, { w: width, h: height });
  const output = outputDimensions(frame, transform);
  const identity = isIdentityTransform(transform);

  const icons = [
    {
      id: "rotate-left",
      label: t("transform.rotateLeft"),
      Icon: RotateCcw,
      onClick: () => setVideoTransform({ rotation: (transform.rotation + 270) % 360 }),
    },
    {
      id: "rotate-right",
      label: t("transform.rotateRight"),
      Icon: RotateCw,
      onClick: () => setVideoTransform({ rotation: (transform.rotation + 90) % 360 }),
    },
    {
      id: "flip-h",
      label: t("transform.flipH"),
      Icon: FlipHorizontal2,
      pressed: transform.flipH,
      onClick: () => setVideoTransform({ flipH: !transform.flipH }),
    },
    {
      id: "flip-v",
      label: t("transform.flipV"),
      Icon: FlipVertical2,
      pressed: transform.flipV,
      onClick: () => setVideoTransform({ flipV: !transform.flipV }),
    },
  ];

  return (
    <TooltipProvider>
      <InspectorGroup title={t("transform.title")}>
        <div className="flex items-center gap-1" role="group" aria-label={t("transform.title")}>
          {icons.map(({ id, label, Icon, pressed, onClick }) => (
            <Tooltip key={id} label={label}>
              <Button
                type="button"
                variant="tertiary"
                size="icon"
                aria-label={label}
                aria-pressed={pressed}
                disabled={locked}
                onClick={onClick}
              >
                <Icon size={14} />
              </Button>
            </Tooltip>
          ))}
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            className="ml-auto !text-[10px]"
            disabled={locked || identity}
            onClick={() => setVideoTransform(IDENTITY_TRANSFORM)}
          >
            {t("transform.reset")}
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("transform.resolution")}>
          {HEIGHTS.map((target) => (
            <Button
              key={target ?? "original"}
              type="button"
              variant="secondary"
              size="sm"
              className="w-full !text-[10px]"
              aria-pressed={transform.outputHeight === target}
              disabled={locked}
              onClick={() => setVideoTransform({ outputHeight: target })}
            >
              {target === null ? t("transform.heightOriginal") : `${target}p`}
            </Button>
          ))}
        </div>
        <p className="inspector-helper">
          {t("transform.output", { width: output.width, height: output.height })}
        </p>
      </InspectorGroup>
    </TooltipProvider>
  );
}
