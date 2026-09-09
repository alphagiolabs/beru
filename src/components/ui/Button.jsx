import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const Button = forwardRef(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    disabled = false,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={cn("cap-btn", `cap-btn--${variant}`, `cap-btn--size-${size}`, className)}
      data-beru-button="true"
      data-loading={loading ? "true" : undefined}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
    >
      {loading && (
        <span className="cap-btn-loader" aria-hidden="true">
          <Loader2 size={14} />
        </span>
      )}
      <span className="cap-btn-content">{children}</span>
    </button>
  );
});

Button.displayName = "Button";

export { Button };
