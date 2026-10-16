import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play, ScanEye, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/tooltip";
import { useT } from "../../i18n/useT";
import { beruLocalUrl } from "../../utils/beru-url";
import { clipLayerGeometry } from "../../../shared/clip-transform.js";
import { formatTimecode, usToSeconds } from "./editor-model.js";
import { entryAt } from "./playback/scene.js";
import { recordSeek, seekIsSlow } from "./playback/proxy-policy.js";
import { useMontagePlayer } from "./playback/useMontagePlayer.js";
import { useEditorSession } from "./store/useEditorSession.js";
import { useTimelineStore } from "./store/useTimelineStore.js";
import OverlayLayer from "./OverlayLayer.jsx";

const PROXY_STATUSES = new Set(["noVideo", "error"]);
const STATUS_MESSAGES = {
  missing: "editor.status.missing",
  loading: "editor.loading",
  noVideo: "editor.errorNoVideo",
  error: "editor.errorPlayback",
};

export default function EditorPreview({
  layout,
  duration,
  canvas,
  fps,
  overlays,
  assetsById,
  assetStatus,
  previewPaths,
  proxyBusy,
  onCreateProxy,
  exactFrame,
  onExactFrame,
  onCloseExactFrame,
  canvasControl,
}) {
  const t = useT();
  const playhead = useEditorSession((s) => s.playhead);
  const playing = useEditorSession((s) => s.playing);
  const setPlaying = useEditorSession((s) => s.setPlaying);
  const setPlayhead = useEditorSession((s) => s.setPlayhead);

  const sourceUrlFor = useCallback(
    (assetId) => {
      const asset = assetsById[assetId];
      if (!asset || (assetStatus[assetId] ?? "ready") !== "ready") return null;
      if (previewPaths[assetId]) return beruLocalUrl(previewPaths[assetId]);
      return beruLocalUrl(asset.path, `${asset.mtimeMs}-${asset.sizeBytes}`);
    },
    [assetsById, assetStatus, previewPaths],
  );

  const layerFor = useCallback(
    (entry) => {
      const metadata = assetsById[entry.clip.assetId]?.metadata;
      if (!metadata?.width || !metadata?.height) return null;
      return clipLayerGeometry(entry.clip.transform, metadata, canvas);
    },
    [assetsById, canvas],
  );

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRefs = [useRef(null), useRef(null)];
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / canvas.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas.width]);

  const seekSamples = useRef(new Map());
  const onSeekTimed = useCallback(
    (assetId, ms) => {
      const samples = recordSeek(seekSamples.current.get(assetId) ?? [], ms);
      seekSamples.current.set(assetId, samples);
      const asset = assetsById[assetId];
      if (!asset || previewPaths[assetId] || !seekIsSlow(samples)) return;
      if (!useTimelineStore.getState().requestProxy(assetId)) return;
      onCreateProxy(asset, { automatic: true });
    },
    [assetsById, previewPaths, onCreateProxy],
  );

  const { refs, active, status } = useMontagePlayer({
    layout,
    duration,
    sourceUrlFor,
    layerFor,
    frames: frameRefs,
    playing,
    playhead,
    onPlayhead: setPlayhead,
    onPlayingChange: setPlaying,
    onSeekTimed,
  });

  const totalSeconds = usToSeconds(duration);
  const videoEnd = layout.at(-1)?.endUs ?? 0;
  const inTail = duration > videoEnd && playhead >= videoEnd;
  const headEntry = entryAt(layout, playhead);
  const headAssetId = headEntry?.clip.assetId ?? null;
  const headAsset = headAssetId ? assetsById[headAssetId] : null;
  const canProxy =
    headAsset &&
    PROXY_STATUSES.has(status) &&
    !previewPaths[headAssetId] &&
    (assetStatus[headAssetId] ?? "ready") === "ready";

  const messageKey = layout.length === 0 ? "editor.noClip" : STATUS_MESSAGES[status];
  const message = messageKey ? t(messageKey) : null;

  const togglePlay = () => {
    if (layout.length === 0) return;
    setPlaying(!playing);
  };

  return (
    <section className="editor-preview">
      <div className="editor-stage" ref={stageRef}>
        <div
          className="editor-canvas"
          ref={canvasRef}
          style={{
            "--canvas-ratio": canvas.width / canvas.height,
            "--canvas-bg": canvas.background,
          }}
        >
          <div
            className="editor-canvas-stage"
            style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}
          >
            {[0, 1].map((slot) => (
              <div
                key={slot}
                ref={frameRefs[slot]}
                className={`editor-clip-frame${active === slot && !inTail ? " is-active" : ""}`}
              >
                <video ref={refs[slot]} className="editor-video" playsInline preload="auto" />
              </div>
            ))}
          </div>
          <OverlayLayer
            overlays={overlays}
            playhead={playhead}
            assetsById={assetsById}
            assetStatus={assetStatus}
          />
        </div>
        {message ? (
          <div className="editor-stage-message">
            <span>{message}</span>
            {canProxy ? (
              <Button
                variant="secondary"
                size="sm"
                loading={proxyBusy}
                onClick={() => onCreateProxy(headAsset)}
              >
                {proxyBusy ? t("editor.proxy.creating") : t("editor.proxy.create")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="editor-transport">
        <input
          type="range"
          className="editor-scrubber"
          min={0}
          max={totalSeconds}
          step={0.01}
          value={usToSeconds(playhead)}
          disabled={layout.length === 0}
          style={{
            "--progress": `${totalSeconds > 0 ? (usToSeconds(playhead) / totalSeconds) * 100 : 0}%`,
          }}
          onChange={(event) => {
            setPlaying(false);
            setPlayhead(Number(event.target.value) * 1_000_000);
          }}
          aria-label={t("editor.seek")}
        />
        <div className="editor-transport-row">
          <span className="editor-time">
            <strong>{formatTimecode(usToSeconds(playhead), fps)}</strong> /{" "}
            {formatTimecode(totalSeconds, fps)}
          </span>
          <Tooltip label={playing ? t("editor.pause") : t("editor.play")}>
            <button
              type="button"
              className="editor-play"
              onClick={togglePlay}
              disabled={layout.length === 0}
              aria-label={playing ? t("editor.pause") : t("editor.play")}
            >
              {playing ? (
                <Pause size={16} strokeWidth={2} fill="currentColor" />
              ) : (
                <Play size={16} strokeWidth={2} fill="currentColor" />
              )}
            </button>
          </Tooltip>
          <div className="editor-transport-end">
            {canvasControl}
            <Button
              variant="tertiary"
              size="sm"
              disabled={layout.length === 0 || exactFrame?.status === "busy"}
              onClick={onExactFrame}
            >
              <ScanEye size={14} strokeWidth={1.75} />
              {t("editor.exactFrame")}
            </Button>
            <Tooltip label={t("editor.fullscreen")}>
              <button
                type="button"
                className="editor-icon-button"
                aria-label={t("editor.fullscreen")}
                onClick={() => stageRef.current?.requestFullscreen?.()}
              >
                <Maximize size={15} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {exactFrame ? (
        <figure className="editor-exact-frame" aria-live="polite">
          {exactFrame.status === "ready" ? (
            <img
              src={beruLocalUrl(exactFrame.path, exactFrame.requestId)}
              alt={t("editor.exactFrame")}
            />
          ) : (
            <figcaption className="editor-muted">
              {exactFrame.status === "busy"
                ? t("editor.exactFrameBusy")
                : exactFrame.status === "stale"
                  ? t("editor.exactFrameStale")
                  : exactFrame.error || t("editor.exactFrameError")}
            </figcaption>
          )}
          <button
            type="button"
            className="editor-icon-button"
            onClick={onCloseExactFrame}
            aria-label={t("common.close")}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </figure>
      ) : null}
    </section>
  );
}
