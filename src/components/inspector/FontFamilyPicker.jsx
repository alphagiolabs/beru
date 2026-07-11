import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import useCloseOnOutsideClick from "../../hooks/useCloseOnOutsideClick";

/**
 * Dark-theme font family picker for the inspector.
 * Replaces native <select> so the menu matches the app UI (not OS chrome).
 */
export default function FontFamilyPicker({
  value,
  options = [],
  onChange,
  disabled = false,
  label = "Fuente",
  ariaLabel = "Fuente",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selected = value || options[0] || "";

  useCloseOnOutsideClick(rootRef, open, setOpen);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, selected]);

  const commit = (next, { close = true } = {}) => {
    if (disabled) return;
    onChange?.(next);
    if (close) setOpen(false);
  };

  const onTriggerKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e) => {
    const items = options;
    if (!items.length) return;
    const idx = Math.max(
      0,
      items.findIndex((f) => f === selected),
    );

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      commit(items[Math.min(items.length - 1, idx + 1)], { close: false });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      commit(items[Math.max(0, idx - 1)], { close: false });
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      commit(items[0], { close: false });
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      commit(items[items.length - 1], { close: false });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`inspector-font-picker${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
    >
      <button
        type="button"
        className="inspector-font-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="inspector-font-picker-key">{label}</span>
        <span className="inspector-font-picker-value" style={{ fontFamily: selected || "inherit" }}>
          {selected}
        </span>
        <ChevronDown size={12} className="inspector-font-picker-chevron" aria-hidden />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          className="inspector-font-picker-menu"
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {options.map((font) => {
            const isSelected = font === selected;
            return (
              <li key={font} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`inspector-font-picker-option${isSelected ? " is-selected" : ""}`}
                  style={{ fontFamily: font }}
                  onClick={() => commit(font)}
                >
                  <span className="inspector-font-picker-option-label">{font}</span>
                  {isSelected ? (
                    <Check size={12} className="inspector-font-picker-check" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
