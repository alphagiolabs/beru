import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Presentational inset group for the right inspector.
 * Optional collapse: auto-expands when `forceOpen` becomes true (active feature).
 */
export default function InspectorGroup({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  forceOpen = false,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  const panelId = useId();

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  if (!collapsible) {
    return (
      <section className={`inspector-group ${className}`.trim()}>
        {title ? <h3 className="inspector-group-title">{title}</h3> : null}
        <div className="inspector-group-body">{children}</div>
      </section>
    );
  }

  return (
    <section className={`inspector-group inspector-group--collapsible ${className}`.trim()}>
      <button
        type="button"
        className="inspector-group-header"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className="inspector-group-title !mb-0">{title}</h3>
        <ChevronDown
          size={14}
          className={`inspector-group-chevron${open ? " is-open" : ""}`}
          aria-hidden
        />
      </button>
      <div
        id={panelId}
        className={`inspector-collapse${open ? " is-open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="inspector-collapse-inner">
          <div className="inspector-group-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
