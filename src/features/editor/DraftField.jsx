import { useEffect, useState } from "react";

export default function DraftField({ label, value, onCommit, type = "number", ...inputProps }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    if (type === "number" && !Number.isFinite(Number(draft))) {
      setDraft(value);
      return;
    }
    onCommit(type === "number" ? Number(draft) : draft);
  };
  return (
    <label>
      {label}
      <input
        type={type}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        {...inputProps}
      />
    </label>
  );
}
