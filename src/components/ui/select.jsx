import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY = "__beru_empty__";
const toItemValue = (v) => (v === "" || v == null ? EMPTY : String(v));
const fromItemValue = (v) => (v === EMPTY ? "" : v);

function SelectOption({ value, label }) {
  return (
    <SelectPrimitive.Item
      value={toItemValue(value)}
      className="ui-dropdown-item ui-dropdown-item--checkable"
    >
      <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      <span className="ui-dropdown-item-indicator">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function Select({
  value,
  onValueChange,
  options,
  variant = "field",
  size = "md",
  disabled = false,
  placeholder,
  className,
  contentClassName,
  ...triggerProps
}) {
  const sizerOptions = variant === "ghost" ? options.flatMap((o) => o.options ?? [o]) : [];
  return (
    <SelectPrimitive.Root
      value={toItemValue(value)}
      onValueChange={(v) => onValueChange(fromItemValue(v))}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "ui-select-trigger",
          `ui-select-trigger--${variant}`,
          `ui-select-trigger--${size}`,
          className,
        )}
        {...triggerProps}
      >
        <span className="ui-select-stack">
          <span className="ui-select-value">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          {sizerOptions.map((o) => (
            <span key={o.value} className="ui-select-sizer" aria-hidden="true">
              {o.label}
            </span>
          ))}
        </span>
        <SelectPrimitive.Icon className="ui-select-icon">
          <ChevronDown size={12} strokeWidth={2} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn("ui-dropdown-content ui-select-content", contentClassName)}
        >
          <SelectPrimitive.Viewport>
            {options.map((opt) =>
              opt.options ? (
                <SelectPrimitive.Group key={opt.label} className="ui-select-group">
                  <SelectPrimitive.Label className="ui-dropdown-label">
                    {opt.label}
                  </SelectPrimitive.Label>
                  {opt.options.map((o) => (
                    <SelectOption key={o.value} {...o} />
                  ))}
                </SelectPrimitive.Group>
              ) : (
                <SelectOption key={opt.value} {...opt} />
              ),
            )}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
