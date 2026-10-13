import { useEffect, useState } from "react";
import { Plus, Save, FolderOpen, FolderOutput, Play } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";
import { Select } from "./ui/select";
import MediaToolDialog from "./MediaToolDialog";
import { compositionJob } from "../utils/composition";
import { sanitizeFilenamePart } from "../utils/batch-process";
import { beruLocalUrl } from "../utils/beru-url";

import { compositionDuration } from "../../shared/composition-document.js";
import CompositionEntries from "./composition/CompositionEntries";
import CompositionPreview from "./composition/CompositionPreview";
import CompositionCanvas from "./composition/CompositionCanvas";
import { useCompositionDocumentIO } from "./composition/useCompositionDocumentIO";
import { useCompositionPreview } from "./composition/useCompositionPreview";

export default function CompositionModal() {
  const t = useT(),
    get = useEditorStore.getState;
  const show = useEditorStore((s) => s.showCompositionModal),
    document = useEditorStore((s) => s.composition),
    queue = useEditorStore((s) => s.queue),
    selectedIdx = useEditorStore((s) => s.selectedIdx),
    isProcessing = useEditorStore((s) => s.isProcessing),
    outputDir = useEditorStore((s) => s.outputDir),
    result = useEditorStore((s) => s.mediaExport);
  const [selectedId, setSelectedId] = useState(null),
    [sourceIdx, setSourceIdx] = useState(selectedIdx);
  const selectedEntry =
    document?.entries.find((entry) => entry.id === selectedId) || document?.entries[0];
  useEffect(() => {
    if (show) setSourceIdx(useEditorStore.getState().selectedIdx);
  }, [show]);
  const warn = () => get().showToast({ kind: "err", text: t("composition.invalid") });
  const {
    busy: documentBusy,
    load,
    save,
    chooseOutput,
  } = useCompositionDocumentIO({
    open: show,
    document,
    onLoaded: () => setSelectedId(null),
    onError: warn,
  });
  const previewState = useCompositionPreview({
    open: show,
    document,
    entry: selectedEntry,
    onError: warn,
  });
  const locked = isProcessing || documentBusy || previewState.busy;
  const settings = (patch) => {
    if (!get().setCompositionSettings(patch)) warn();
  };
  const edit = (patch) => get().editCompositionEntry(selectedEntry.id, patch);
  const exportComposition = async () => {
    const name = sanitizeFilenamePart(document.outputName.replace(/\.mp4$/i, "")) || "composition";
    const job = compositionJob(document, {
      outputPath: `${outputDir}/${name}.mp4`,
      encodeProfile: get().encodeProfile,
    });
    const response = await get().exportMediaArtifact(job, { signature: JSON.stringify(document) });
    if (!response.ok && !response.cancelled && !response.notified) warn();
  };
  const duration = compositionDuration(document);
  const mediaResult = result?.kind === "composition" ? result : null;
  return (
    <MediaToolDialog
      open={show}
      onOpenChange={get().setShowCompositionModal}
      title={t("composition.title")}
      description={t("composition.description")}
    >
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label={t("composition.sourceToAdd")}
            className="min-w-[180px] max-w-[280px]"
            disabled={locked || !queue.length}
            value={queue[sourceIdx] ? String(sourceIdx) : ""}
            placeholder={t("composition.sourceToAdd")}
            options={queue.map((item, index) => ({ value: String(index), label: item.filename }))}
            onValueChange={(value) => setSourceIdx(Number(value))}
          />
          <Button
            disabled={locked || !queue[sourceIdx]}
            onClick={() => {
              if (!get().addCompositionEntry(sourceIdx)) warn();
            }}
          >
            <Plus size={14} />
            {t("composition.addSelected")}
          </Button>
          <Button disabled={locked} onClick={load}>
            <FolderOpen size={14} />
            {t("composition.load")}
          </Button>
          <Button disabled={locked || !document?.entries.length} onClick={save}>
            <Save size={14} />
            {t("composition.save")}
          </Button>
          <Button disabled={locked} onClick={chooseOutput}>
            <FolderOutput size={14} />
            {t("header.selectOutput")}
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <CompositionEntries
            document={document}
            selectedEntry={selectedEntry}
            locked={locked}
            onSelect={setSelectedId}
            onMove={get().moveCompositionEntry}
            onRemove={get().removeCompositionEntry}
            edit={edit}
          />
          <div className="space-y-2">
            <CompositionPreview entry={selectedEntry} locked={locked} {...previewState} />
            <CompositionCanvas document={document} locked={locked} settings={settings} />
          </div>
        </div>
        {document && (
          <label className="block text-[11px]">
            {t("composition.outputName")}
            <input
              className="cap-input w-full mt-1"
              aria-label={t("composition.outputName")}
              value={document.outputName}
              disabled={locked}
              onChange={(event) => settings({ outputName: event.target.value })}
            />
          </label>
        )}
        <p className="text-[11px] text-[var(--text-secondary)]">
          {t("composition.policy", { seconds: duration.toFixed(2) })}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={locked || !outputDir || (document?.entries.length || 0) < 2}
            onClick={exportComposition}
          >
            <Play size={14} />
            {t("composition.export")}
          </Button>
          {isProcessing && mediaResult?.status === "processing" && (
            <>
              <span className="text-[11px] tabular-nums">{Math.round(mediaResult.progress)}%</span>
              <Button onClick={() => get().cancelProcessing()}>{t("common.cancel")}</Button>
            </>
          )}
        </div>
        {!outputDir && <p className="text-[11px]">{t("composition.needsOutput")}</p>}
        {mediaResult?.confirmedOutputPath && (
          <div className="space-y-2">
            <p className="text-[11px]">
              {t(
                mediaResult.confirmedSignature === JSON.stringify(document)
                  ? "composition.confirmedOutput"
                  : "composition.previousOutput",
              )}
            </p>
            <video
              src={beruLocalUrl(mediaResult.confirmedOutputPath, String(mediaResult.confirmedAt))}
              controls
              preload="metadata"
              className="max-h-[200px] max-w-full"
            />
          </div>
        )}
      </div>
    </MediaToolDialog>
  );
}
