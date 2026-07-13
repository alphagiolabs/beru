import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Presentational inset group for the right inspector.
 * Optional collapse: auto-expands when `forceOpen` becomes true (active feature).
 * `headerAccessory` stays outside the inert collapse panel (e.g. master toggles).
 */
export default function InspectorGroup({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  forceOpen = false,
  /** When true, collapses automatically if forceOpen becomes false (toggle sections). */
  collapseWhenOff = false,
  /** Hide the expand chevron (useful when a switch already drives open state). */
  hideChevron = false,
  headerAccessory = null,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  const panelId = useId();

  useEffect(() => {
    if (forceOpen) setOpen(true);
    else if (collapseWhenOff) setOpen(false);
  }, [forceOpen, collapseWhenOff]);

  if (!collapsible) {
    return (
      <section className={`inspector-group ${className}`.trim()}>
        {title || headerAccessory ? (
          <div className="inspector-group-heading">
            {title ? <h3 className="inspector-group-title !mb-0">{title}</h3> : null}
            {headerAccessory}
          </div>
        ) : null}
        <div className="inspector-group-body">{children}</div>
      </section>
    );
  }

  return (
    <section
      className={`inspector-group inspector-group--collapsible${hideChevron ? " inspector-group--no-chevron" : ""} ${className}`.trim()}
    >
      <div className="inspector-group-header-row">
        <button
          type="button"
          className="inspector-group-header"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <h3 className="inspector-group-title !mb-0">{title}</h3>
          {hideChevron ? null : (
            <ChevronDown
              size={14}
              className={`inspector-group-chevron${open ? " is-open" : ""}`}
              aria-hidden
            />
          )}
        </button>
        {headerAccessory ? (
          <div
            className="inspector-group-header-accessory"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {headerAccessory}
          </div>
        ) : null}
      </div>
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
