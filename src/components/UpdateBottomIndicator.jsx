import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

export default function UpdateBottomIndicator() {
  const status = useEditorStore((s) => s.update?.status);
  const t = useT();

  const active = status === "checking" || status === "downloading";
  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("updater.bottomActive")}
      className="update-bottom-indicator fixed bottom-0 left-0 right-0 z-[80] pointer-events-none"
    />
  );
}
