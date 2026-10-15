import { FileVideo, Image as ImageIcon, Upload, RefreshCw } from "lucide-react";
import { useT } from "../../i18n/useT";
import { formatClock, isImageAsset, usToSeconds } from "./editor-model.js";

const NEEDS_RELINK = new Set(["missing", "changed", "authorization-required"]);

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
      <header className="editor-panel-head">
        <h2>{t("editor.library")}</h2>
        <button type="button" className="editor-button" onClick={onImport}>
          <Upload size={14} strokeWidth={1.75} />
          {t("editor.import")}
        </button>
      </header>
      {assets.length === 0 ? (
        <p className="editor-muted">{t("editor.libraryEmpty")}</p>
      ) : (
        <ul className="editor-asset-list">
          {assets.map((asset) => {
            const status = assetStatus[asset.id] ?? "ready";
            const usable = status === "ready";
            const image = isImageAsset(asset);
            const Icon = image ? ImageIcon : FileVideo;
            return (
              <li
                key={asset.id}
                className={`editor-asset${usedAssetIds.has(asset.id) ? " is-used" : ""}`}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                <div className="editor-asset-body">
                  <span className="editor-asset-name" title={asset.path}>
                    {asset.filename}
                  </span>
                  <span className="editor-muted">
                    {image
                      ? t("editor.imageLayer")
                      : formatClock(usToSeconds(asset.metadata.durationUs))}
                    {" · "}
                    {t(`editor.status.${status}`)}
                  </span>
                </div>
                {NEEDS_RELINK.has(status) ? (
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => onRelink(asset.id)}
                  >
                    <RefreshCw size={14} strokeWidth={1.75} />
                    {t("editor.relink")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-button"
                  disabled={!usable}
                  onClick={() => (image ? onAddLayer : onAppend)(asset.id)}
                >
                  {t(image ? "editor.addLayer" : "editor.useClip")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
