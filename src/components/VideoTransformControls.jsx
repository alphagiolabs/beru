import { useState } from "react";
import { FlipHorizontal2, FlipVertical2, Link2, Link2Off, RotateCcw, RotateCw } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { InspectorGroup, SegmentedToolbar } from "./inspector";
import { frameAfterCrops } from "../utils/crop-output";
import {
  FIT_MODES,
  normalizeTransform,
  outputLayout,
  isIdentityTransform,
  IDENTITY_TRANSFORM,
  ASPECT_FILL_TOLERANCE,
} from "../utils/output-geometry";
import { getLockedDimensions } from "../utils/video-dimensions";

const even = (n) => Math.max(16, Math.round(n / 2) * 2);
const ASPECTS = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["9:16", 9 / 16],
];
const HEIGHTS = [1080, 720, 480];
const sameAspect = (a, b) => Math.abs(a / b - 1) <= ASPECT_FILL_TOLERANCE;
const namedAspect = (ratio) => ASPECTS.find(([, r]) => sameAspect(ratio, r))?.[1] ?? ratio;

function SizeInput({ label, value, disabled, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    const next = Math.round(Number(draft));
    setDraft(null);
    if (draft !== null && Number.isFinite(next) && next > 0 && next !== value) onCommit(next);
  };
  return (
    <label className="flex-1 min-w-0">
      <span className="cap-input-label">{label}</span>
      <input
        type="number"
        min={16}
        max={8192}
        step={2}
        aria-label={label}
        disabled={disabled}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="cap-input font-mono text-[11px]"
      />
    </label>
  );
}
function PresetRow({ label, options, disabled }) {
  return (
    <div>
      <span className="cap-input-label">{label}</span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1 min-w-0 !px-1 !text-[10px]"
            aria-pressed={option.pressed}
            disabled={disabled}
            onClick={option.onClick}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function VideoTransformControls() {
  const t = useT();
  const item = useEditorStore((s) => (s.selectedIdx >= 0 ? s.queue[s.selectedIdx] : null));
  const locked = useEditorStore((s) => s.isProcessing);
  const setVideoTransform = useEditorStore((s) => s.setVideoTransform);
  const editsSource = useEditorStore(
    (s) => s.sidebarMode === "logo" && s.editorWorkspace !== "datetime",
  );
  const [lockAspect, setLockAspect] = useState(true);
  if (!item) return null;

  const transform = normalizeTransform(item.transform);
  const { width, height } = getLockedDimensions(item);
  const frame = frameAfterCrops(item.operations, { w: width, h: height });
  const output = outputLayout(frame, transform);
  const { content } = output;
  const liveDiffers =
    editsSource &&
    (transform.rotation !== 0 ||
      transform.flipH ||
      transform.flipV ||
      content.x !== 0 ||
      content.y !== 0 ||
      content.w !== output.width ||
      content.h !== output.height);
  const identity = isIdentityTransform(transform);
  const aspect = namedAspect(output.width / output.height);
  const sourceAspect =
    transform.rotation % 180 ? frame.height / frame.width : frame.width / frame.height;
  const setSize = (width, height) => {
    const nextWidth = width ?? (lockAspect ? even(height * aspect) : output.width);
    const nextHeight = height ?? (lockAspect ? even(width / aspect) : output.height);
    setVideoTransform({
      outputWidth: even(nextWidth),
      outputHeight: even(nextHeight),
      fitMode: transform.outputWidth === null ? "pad" : transform.fitMode,
    });
  };
  const setAspect = (ratio) => setSize(even(output.height * ratio), output.height);

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
        <PresetRow
          label={t("transform.aspect")}
          disabled={locked}
          options={[
            {
              id: "original",
              label: t("transform.aspectOriginal"),
              pressed: sameAspect(output.width / output.height, sourceAspect),
              onClick: () => setAspect(sourceAspect),
            },
            ...ASPECTS.map(([id, ratio]) => ({
              id,
              label: id,
              pressed: aspect === ratio,
              onClick: () => setAspect(ratio),
            })),
          ]}
        />
        <PresetRow
          label={t("transform.resolution")}
          disabled={locked}
          options={[
            {
              id: "original",
              label: t("transform.heightOriginal"),
              pressed: transform.outputHeight === null,
              onClick: () => setVideoTransform({ outputHeight: null, outputWidth: null }),
            },
            ...HEIGHTS.map((target) => ({
              id: target,
              label: `${target}p`,
              pressed: transform.outputHeight !== null && output.height === target,
              onClick: () => setSize(even(target * aspect), target),
            })),
          ]}
        />
        <div className="flex items-end gap-1.5" role="group" aria-label={t("transform.size")}>
          <SizeInput
            label={t("transform.width")}
            value={output.width}
            disabled={locked}
            onCommit={(width) => setSize(width, null)}
          />
          <Tooltip label={t(lockAspect ? "transform.unlockAspect" : "transform.lockAspect")}>
            <Button
              type="button"
              variant="tertiary"
              size="icon"
              aria-pressed={lockAspect}
              aria-label={t(lockAspect ? "transform.unlockAspect" : "transform.lockAspect")}
              onClick={() => setLockAspect(!lockAspect)}
            >
              {lockAspect ? <Link2 size={14} /> : <Link2Off size={14} />}
            </Button>
          </Tooltip>
          <SizeInput
            label={t("transform.height")}
            value={output.height}
            disabled={locked}
            onCommit={(height) => setSize(null, height)}
          />
        </div>
        {transform.outputWidth !== null && (
          <div>
            <span className="cap-input-label">{t("transform.fit.label")}</span>
            <SegmentedToolbar
              ariaLabel={t("transform.fit.label")}
              value={transform.fitMode}
              disabled={locked}
              onChange={(fitMode) => setVideoTransform({ fitMode })}
              options={FIT_MODES.map((mode) => ({
                value: mode,
                label: t(`transform.fit.${mode}`),
                title: t(`transform.fit.${mode}Hint`),
              }))}
            />
          </div>
        )}
        <p className="inspector-helper">
          {t("transform.output", { width: output.width, height: output.height })}
        </p>
        {liveDiffers && <p className="inspector-helper">{t("transform.liveHint")}</p>}
      </InspectorGroup>
    </TooltipProvider>
  );
}
