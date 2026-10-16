import { Volume2, VolumeX } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { InspectorGroup } from "./inspector";
import { normalizeAudio } from "../utils/audio-settings";
import HistoryRange from "./HistoryRange.jsx";

export default function VideoAudioControls() {
  const t = useT();
  const item = useEditorStore((s) => (s.selectedIdx >= 0 ? s.queue[s.selectedIdx] : null));
  const locked = useEditorStore((s) => s.isProcessing);
  const setVideoAudio = useEditorStore((s) => s.setVideoAudio);
  if (!item) return null;

  const audio = normalizeAudio(item.audio);
  const hasAudio = Boolean(item.audioCodec) || Number(item.audioChannels) > 0;
  const disabled = locked || !hasAudio;
  const percent = Math.round(audio.gain * 100);
  const muteLabel = audio.muted ? t("audio.unmute") : t("audio.mute");

  return (
    <TooltipProvider>
      <InspectorGroup title={t("audio.title")}>
        {hasAudio ? (
          <div className="flex items-center gap-2">
            <Tooltip label={muteLabel}>
              <Button
                type="button"
                variant="tertiary"
                size="icon"
                aria-label={muteLabel}
                aria-pressed={audio.muted}
                disabled={disabled}
                onClick={() => setVideoAudio({ muted: !audio.muted })}
              >
                {audio.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </Button>
            </Tooltip>
            <label
              className="flex min-w-0 flex-1 items-center gap-2 text-[11px]"
              style={{ color: "var(--text-dim)" }}
            >
              {t("audio.volume")}
              <HistoryRange
                min="0"
                max="100"
                step="5"
                aria-label={t("audio.volume")}
                value={percent}
                disabled={disabled || audio.muted}
                className="inspector-range"
                onValueChange={(value, options) => setVideoAudio({ gain: value / 100 }, options)}
              />
              <span className="font-mono text-xs" style={{ color: "var(--text-brand)" }}>
                {percent}%
              </span>
            </label>
          </div>
        ) : (
          <p className="inspector-helper">{t("audio.none")}</p>
        )}
      </InspectorGroup>
    </TooltipProvider>
  );
}
