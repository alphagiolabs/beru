import { DELOGO_METHODS } from "../utils/types";
import { useT } from "../i18n/useT";

export default function DelogoMethodHelp({ methodId }) {
  const t = useT();
  const method = DELOGO_METHODS.find((m) => m.id === methodId);
  if (!method) return null;
  return (
    <p className="inspector-helper">
      <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
        {t(method.groupKey)}
      </span>
      {" · "}
      {t(method.descriptionKey)}
    </p>
  );
}
