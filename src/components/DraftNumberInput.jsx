import { useRef, useState } from "react";

// Partial input stays local. A false onCommit result leaves the undo session open
// so the next effective edit records its own history step.
export default function DraftNumberInput({
  value,
  onCommit,
  step = 1,
  largeStep = step * 10,
  clearable = false,
  ...inputProps
}) {
  const [draft, setDraft] = useState(null);
  const editing = useRef(false);

  const current = value === "" || value == null ? null : Number(value);

  const commit = (next) => {
    if (next === current) return;
    const applied = onCommit(next, { recordHistory: !editing.current });
    if (applied !== false) editing.current = true;
  };

  return (
    <input
      type="number"
      {...inputProps}
      value={draft ?? value}
      // React's onChange skips edits that leave the value unchanged (a badInput field stays
      // ""), so every native edit is read from onInput; onChange only satisfies controlled-input rules.
      onChange={() => {}}
      onInput={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (e.target.validity?.badInput) return;
        if (text.trim() === "") {
          if (clearable) commit(null);
          return;
        }
        const next = Number(text);
        if (Number.isFinite(next)) commit(next);
      }}
      onKeyDown={(e) => {
        inputProps.onKeyDown?.(e);
        if (e.key === "Enter" || e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const base = Number(value);
        if (!Number.isFinite(base)) return;
        e.preventDefault();
        const delta = e.shiftKey ? largeStep : step;
        const direction = e.key === "ArrowUp" ? 1 : -1;
        setDraft(null);
        commit(Number((base + direction * delta).toFixed(3)));
      }}
      onBlur={(e) => {
        inputProps.onBlur?.(e);
        editing.current = false;
        setDraft(null);
      }}
    />
  );
}
