import { FileVideo, Image as ImageIcon, Plus, Upload, RefreshCw } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/tooltip";
import { beruLocalUrl } from "../../utils/beru-url";
import useFilmstripFrames from "../../components/video-preview/useFilmstripFrames";
import {
  ASSET_DRAG_TYPE,
  IMAGE_DRAG_TYPE,
  formatClock,
  isImageAsset,
  usToSeconds,
} from "./editor-model.js";

const NEEDS_RELINK = new Set(["missing", "changed", "authorization-required"]);

function AssetThumb({ asset, image, usable }) {
  const seconds = usable && !image ? usToSeconds(asset.metadata.durationUs) : 0;
  const { frames } = useFilmstripFrames(seconds > 0 ? asset.path : null, seconds, 1, {
    owner: `asset:${asset.id}`,
  });
  const src = !usable
    ? null
    : image
      ? beruLocalUrl(asset.path, `${asset.mtimeMs}-${asset.sizeBytes}`)
      : frames[0];
  const Icon = image ? ImageIcon : FileVideo;
  return src ? (
    <img src={src} alt="" draggable={false} />
  ) : (
    <Icon size={20} strokeWidth={1.5} aria-hidden />
  );
}

export default function EditorLibrary({
  assets,
  assetStatus,
  usedAssetIds,
  onImport,
  onAppend,
  onAddLayer,
  onRelink,
}) {
  const t = useT();
  return (
    <section className="editor-library" aria-label={t("editor.library")}>
      <header className="editor-side-head">
        <h2>{t("editor.library")}</h2>
        <Button variant="secondary" size="sm" onClick={onImport}>
          <Upload size={14} strokeWidth={1.75} />
          {t("editor.import")}
        </Button>
      </header>
      {assets.length === 0 ? (
        <button type="button" className="editor-library-drop" onClick={onImport}>
          <Upload size={18} strokeWidth={1.5} aria-hidden />
          <span className="editor-muted">{t("editor.libraryEmpty")}</span>
        </button>
      ) : (
        <ul className="editor-asset-list">
          {assets.map((asset) => {
            const status = assetStatus[asset.id] ?? "ready";
            const usable = status === "ready";
            const image = isImageAsset(asset);
            const addLabel = t(image ? "editor.addLayer" : "editor.useClip");
            return (
              <li
                key={asset.id}
                className={`editor-asset${usedAssetIds.has(asset.id) ? " is-used" : ""}${usable ? "" : " is-missing"}`}
                draggable={usable}
                onDragStart={(event) => {
                  event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                  if (image) event.dataTransfer.setData(IMAGE_DRAG_TYPE, "");
                  event.dataTransfer.effectAllowed = "copy";
                }}
              >
                <div className="editor-asset-thumb">
                  <AssetThumb asset={asset} image={image} usable={usable} />
                  {image ? null : (
                    <span className="editor-asset-duration">
                      {formatClock(usToSeconds(asset.metadata.durationUs))}
                    </span>
                  )}
                  <Tooltip label={addLabel}>
                    <button
                      type="button"
                      className="editor-asset-add"
                      disabled={!usable}
                      aria-label={addLabel}
                      onClick={() => (image ? onAddLayer : onAppend)(asset.id)}
                    >
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  </Tooltip>
                </div>
                <span className="editor-asset-name" title={asset.path}>
                  {asset.filename}
                </span>
                <span className="editor-muted">
                  {image ? `${t("editor.imageLayer")} · ` : ""}
                  {t(`editor.status.${status}`)}
                </span>
                {NEEDS_RELINK.has(status) ? (
                  <Button variant="secondary" size="sm" onClick={() => onRelink(asset.id)}>
                    <RefreshCw size={12} strokeWidth={1.75} />
                    {t("editor.relink")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
