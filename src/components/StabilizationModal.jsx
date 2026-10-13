import { useState } from "react";
import { Focus, ListPlus } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Select } from "./ui/select";
import MediaToolDialog from "./MediaToolDialog";
import { sanitizeFilenamePart } from "../utils/batch-process";
import { beruLocalUrl } from "../utils/beru-url";
import {
  STABILIZATION_DEFAULTS,
  STABILIZATION_EDGES,
  STABILIZATION_INTENSITIES,
  STABILIZATION_SAMPLE_SECONDS,
  stabilizationJob,
} from "../../shared/stabilization.js";

export default function StabilizationModal() {
  const t = useT(),
    get = useEditorStore.getState;
  const show = useEditorStore((s) => s.showStabilizationModal),
    item = useEditorStore((s) => s.queue[s.selectedIdx]),
    isProcessing = useEditorStore((s) => s.isProcessing),
    outputDir = useEditorStore((s) => s.outputDir),
    result = useEditorStore((s) => s.mediaExport);
  const [settings, setSettings] = useState(STABILIZATION_DEFAULTS);
  const mediaResult = result?.kind === "stabilization" ? result : null;
  const ready = Boolean(item?.path) && Boolean(outputDir) && !isProcessing;
  const signature = (sample) => JSON.stringify({ path: item?.path, settings, sample });
  const warn = () => get().showToast({ kind: "err", text: t("stabilization.invalid") });
  const run = async (sample) => {
    const base = sanitizeFilenamePart(item.filename.replace(/\.[^.]+$/, "")) || "video";
    const job = stabilizationJob(item, settings, {
      outputPath: `${outputDir}/${base}_stabilized${sample ? "_sample" : ""}.mp4`,
      sample,
      encodeProfile: get().encodeProfile,
    });
    const response = await get().exportMediaArtifact(job, { signature: signature(sample) });
    if (!response.ok && !response.cancelled && !response.notified) warn();
  };
  const confirmedSample = mediaResult?.confirmedVariant === "sample";
  const confirmedFull = mediaResult?.confirmedVariant === "full";
  const current =
    (confirmedSample || confirmedFull) &&
    mediaResult?.confirmedSignature === signature(confirmedSample);
  const addToQueue = async () => {
    await get().addVideos([mediaResult.confirmedOutputPath], window.api);
    get().showToast({ kind: "ok", text: t("stabilization.added") });
  };
  const settingSelect = (key, values) => (
    <label className="block text-[11px]">
      {t(`stabilization.${key}`)}
      <Select
        aria-label={t(`stabilization.${key}`)}
        disabled={isProcessing}
        value={settings[key]}
        options={values.map((value) => ({
          value,
          label: t(`stabilization.${key}.${value}`),
        }))}
        onValueChange={(value) => setSettings((prev) => ({ ...prev, [key]: value }))}
      />
    </label>
  );
  return (
    <MediaToolDialog
      open={show}
      onOpenChange={get().setShowStabilizationModal}
      title={t("stabilization.title")}
      description={t("stabilization.description")}
    >
      <div className="p-4 space-y-4">
        {item ? (
          <p className="text-[12px]">
            <span className="text-[var(--text-secondary)]">{t("stabilization.source")}: </span>
            {item.filename}
          </p>
        ) : (
          <p className="text-[12px]">{t("stabilization.noSource")}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {settingSelect("intensity", STABILIZATION_INTENSITIES)}
          {settingSelect("edges", STABILIZATION_EDGES)}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">
          {t("stabilization.policy", { size: item ? `${item.width}×${item.height}` : "-" })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!ready} onClick={() => run(true)}>
            {t("stabilization.sample", { seconds: STABILIZATION_SAMPLE_SECONDS })}
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => run(false)}>
            <Focus size={14} />
            {t("stabilization.run")}
          </Button>
          {isProcessing && mediaResult?.status === "processing" && (
            <>
              <span className="text-[11px] tabular-nums">{Math.round(mediaResult.progress)}%</span>
              <Button onClick={() => get().cancelProcessing()}>{t("common.cancel")}</Button>
            </>
          )}
        </div>
        {!outputDir && <p className="text-[11px]">{t("stabilization.needsOutput")}</p>}
        {mediaResult?.confirmedOutputPath && (
          <div className="space-y-2">
            <p className="text-[11px]">
              {t(
                !current
                  ? "stabilization.previousOutput"
                  : confirmedSample
                    ? "stabilization.sampleOutput"
                    : "stabilization.confirmedOutput",
              )}
            </p>
            <video
              src={beruLocalUrl(mediaResult.confirmedOutputPath, String(mediaResult.confirmedAt))}
              controls
              preload="metadata"
              className="max-h-[220px] max-w-full"
            />
            {confirmedFull && (
              <Button disabled={isProcessing} onClick={addToQueue}>
                <ListPlus size={14} />
                {t("stabilization.addToQueue")}
              </Button>
            )}
          </div>
        )}
      </div>
    </MediaToolDialog>
  );
}
