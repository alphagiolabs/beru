import { useRef, useState } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

function TooltipProvider({ delayDuration = 400, skipDelayDuration = 300, ...props }) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

let lastInputWasKeyboard = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInputWasKeyboard = true), true);
  window.addEventListener("pointerdown", () => (lastInputWasKeyboard = false), true);
}

function canShow(anchor) {
  const target = anchor?.firstElementChild;
  if (!target || target.getAttribute("aria-expanded") === "true") return false;
  return anchor.matches(":hover") || (lastInputWasKeyboard && target.matches(":focus-visible"));
}

function Tooltip({ label, description, shortcut, side = "bottom", align = "center", children }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  if (!label) return children;
  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={(next) => setOpen(next && canShow(anchorRef.current))}
    >
      <TooltipPrimitive.Trigger asChild>
        <span
          ref={anchorRef}
          className="ui-tooltip-anchor"
          onPointerDownCapture={() => setOpen(false)}
        >
          {children}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={`ui-tooltip${description ? " ui-tooltip--rich" : ""}`}
        >
          <span className="ui-tooltip-row">
            <span className="ui-tooltip-label">{label}</span>
            {shortcut && <kbd className="ui-tooltip-kbd">{shortcut}</kbd>}
          </span>
          {description && <span className="ui-tooltip-desc">{description}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { TooltipProvider, Tooltip };
