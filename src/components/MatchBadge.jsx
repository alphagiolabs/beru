import { Check, AlertCircle, Copy, Minus } from "lucide-react";
import { useT } from "../i18n/useT";

const STATUS_META = {
  matched: {
    icon: Check,
    color: "var(--text-accent)",
    labelKey: "match.coincide",
    descKey: "match.coincideDesc",
  },
  unmatched: {
    icon: AlertCircle,
    color: "var(--text-amber)",
    labelKey: "match.sinMatch",
    descKey: "match.sinMatchDesc",
  },
  duplicate: {
    icon: Copy,
    color: "var(--text-rose)",
    labelKey: "match.multiple",
    descKey: "match.multipleDesc",
  },
  none: {
    icon: Minus,
    color: "var(--text-dim)",
    labelKey: "match.noExcel",
    descKey: "match.noExcelDesc",
  },
};

export default function MatchBadge({ status, size = 10 }) {
  const t = useT();
  const meta = STATUS_META[status] || STATUS_META.none;
  const Icon = meta.icon;
  const label = meta.labelKey ? t(meta.labelKey) : "";
  const desc = meta.descKey ? t(meta.descKey) : "";
  return (
    <span
      title={`${label} · ${desc}`}
      className="inline-flex items-center justify-center rounded-full flex-shrink-0"
      style={{
        background: `${meta.color}22`,
        color: meta.color,
        width: size + 4,
        height: size + 4,
      }}
    >
      <Icon size={size} />
    </span>
  );
}
