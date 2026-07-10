import { useId } from "react";

/**
 * Accessible switch replacing native checkboxes in the inspector.
 */
export default function ToggleSwitch({
  checked = false,
  onChange,
  label,
  disabled = false,
  id: idProp,
  ariaLabel,
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const accessibleName = ariaLabel || (typeof label === "string" ? label : undefined);

  return (
    <div className="inspector-switch-row">
      {label ? (
        <label htmlFor={id} className="inspector-switch-label">
          {label}
        </label>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={accessibleName}
        disabled={disabled}
        className={`inspector-switch${checked ? " is-on" : ""}`}
        onClick={() => {
          if (disabled) return;
          onChange?.(!checked);
        }}
      >
        <span className="inspector-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}
