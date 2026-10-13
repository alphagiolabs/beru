import { useEffect, useRef, useState } from "react";
import { Music2, X } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { normalizeAudioAsset } from "../../shared/audio-asset.js";
import { beruLocalUrl } from "../utils/beru-url";
import { Button } from "./ui/Button";
import { Select } from "./ui/select";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { InspectorGroup } from "./inspector";
import DraftNumberInput from "./DraftNumberInput";
import { clipTimeline } from "../../shared/clip-timeline.js";

export default function ExternalAudioControls() {
  const t = useT();
  const index = useEditorStore((s) => s.selectedIdx);
  const item = useEditorStore((s) => s.queue[s.selectedIdx]);
  const locked = useEditorStore((s) => s.isProcessing);
  const setAsset = useEditorStore((s) => s.setExternalAudio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const history = useRef(null);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  if (!item) return null;
  const asset = normalizeAudioAsset(item.externalAudio);
  const videoDuration = clipTimeline(item).cycleDuration;
  const audible = asset
    ? Math.max(
        0,
        Math.min((asset.trimEnd ?? asset.duration) - asset.trimStart, videoDuration - asset.offset),
      )
    : 0;
  const pick = async () => {
    const id = ++request.current;
    const owner = { index, path: item.path };
    setBusy(true);
    setError("");
    try {
      const result = await window.api.pickAudio({
        title: t("audio.pickAsset"),
        filterName: t("audio.title"),
      });
      const state = useEditorStore.getState();
      if (
        id !== request.current ||
        state.selectedIdx !== owner.index ||
        state.queue[owner.index]?.path !== owner.path ||
        state.isProcessing
      )
        return;
      if (result?.success) {
        const next = normalizeAudioAsset(result);
        if (next) setAsset(next);
        else setError(t("audio.assetError"));
      } else if (!result?.canceled)
        setError(
          result?.errorCode ? t("audio.assetError") : result?.error || t("audio.assetError"),
        );
    } catch (err) {
      if (id === request.current) setError(err.message || t("audio.assetError"));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const commit = (field, value, { recordHistory }) => {
    const state = useEditorStore.getState();
    const changed = setAsset(
      { [field]: value },
      {
        recordHistory:
          recordHistory ||
          history.current?.field !== field ||
          history.current?.stack !== state.undoStack,
      },
    );
    if (changed) history.current = { field, stack: useEditorStore.getState().undoStack };
    return changed;
  };
  return (
    <TooltipProvider>
      <InspectorGroup title={t("audio.addedTitle")}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={locked || busy}
            onClick={pick}
          >
            <Music2 size={14} />
            {asset ? t("audio.changeAsset") : t("audio.pickAsset")}
          </Button>
          {asset && (
            <Tooltip label={t("audio.removeAsset")}>
              <Button
                type="button"
                variant="tertiary"
                size="icon"
                aria-label={t("audio.removeAsset")}
                disabled={locked || busy}
                onClick={() => setAsset(null)}
              >
                <X size={14} />
              </Button>
            </Tooltip>
          )}
        </div>
        {error && (
          <p role="alert" className="inspector-helper" style={{ color: "var(--rose)" }}>
            {error}
          </p>
        )}
        {asset && (
          <div key={asset.path} className="grid gap-2 mt-2">
            <Tooltip label={asset.path}>
              <p className="truncate text-[11px]" style={{ color: "var(--text-primary)" }}>
                {asset.name}
              </p>
            </Tooltip>
            <Select
              value={asset.mode}
              onValueChange={(mode) => setAsset({ mode })}
              disabled={locked || busy}
              aria-label={t("audio.assetMode")}
              size="sm"
              options={[
                { value: "mix", label: t("audio.mix") },
                { value: "replace", label: t("audio.replace") },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              {[
                ["offset", "audio.offset"],
                ["trimStart", "audio.assetStart"],
                ["trimEnd", "audio.assetEnd"],
                ["gain", "audio.assetGain"],
              ].map(([field, label]) => (
                <label key={field}>
                  <span className="cap-input-label">{t(label)}</span>
                  <DraftNumberInput
                    aria-label={t(label)}
                    value={asset[field] ?? ""}
                    clearable={field === "trimEnd"}
                    min={0}
                    max={field === "gain" ? 1 : undefined}
                    step={field === "gain" ? 0.05 : 0.1}
                    disabled={locked || busy}
                    onCommit={(value, options) => commit(field, value, options)}
                    onBlur={() => {
                      history.current = null;
                    }}
                    className="cap-input font-mono text-[11px]"
                  />
                </label>
              ))}
            </div>
            <p className="inspector-helper">
              {t("audio.assetTiming", { duration: audible.toFixed(2) })}
            </p>
            <label className="cap-input-label">{t("audio.listenAsset")}</label>
            <audio
              controls
              preload="none"
              src={beruLocalUrl(asset.path, asset.version)}
              className="w-full"
              aria-label={t("audio.listenAsset")}
            />
          </div>
        )}
      </InspectorGroup>
    </TooltipProvider>
  );
}
