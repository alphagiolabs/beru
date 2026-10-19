import { useId } from "react";

export default function ToggleSwitch({ checked = false, onChange, label, ariaLabel }) {
  const id = useId();
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
        className={`inspector-switch${checked ? " is-on" : ""}`}
        onClick={() => onChange?.(!checked)}
      >
        <span className="inspector-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}
