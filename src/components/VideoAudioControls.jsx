import { useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { InspectorGroup } from "./inspector";
import { normalizeAudio } from "../utils/audio-settings";

export default function VideoAudioControls() {
  const t = useT();
  const item = useEditorStore((s) => (s.selectedIdx >= 0 ? s.queue[s.selectedIdx] : null));
  const locked = useEditorStore((s) => s.isProcessing);
  const setVideoAudio = useEditorStore((s) => s.setVideoAudio);
  const sliding = useRef(null);
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
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label={t("audio.volume")}
                value={percent}
                disabled={disabled || audio.muted}
                className="inspector-range"
                onChange={(e) => {
                  const state = useEditorStore.getState();
                  const owner = `${state.selectedIdx}:${item.path}`;
                  const changed = setVideoAudio(
                    { gain: Number(e.target.value) / 100 },
                    {
                      recordHistory:
                        sliding.current?.stack !== state.undoStack ||
                        sliding.current?.owner !== owner,
                    },
                  );
                  if (changed)
                    sliding.current = { stack: useEditorStore.getState().undoStack, owner };
                }}
                onBlur={() => {
                  sliding.current = null;
                }}
                onPointerUp={() => {
                  sliding.current = null;
                }}
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
