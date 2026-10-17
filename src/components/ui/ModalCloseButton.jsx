import { forwardRef } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export const ModalCloseButton = forwardRef(function ModalCloseButton(
  { label, className = "", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="tertiary"
      size="icon"
      aria-label={label}
      className={`cap-modal-close ${className}`.trim()}
      {...props}
    >
      <X size={15} aria-hidden="true" />
    </Button>
  );
});
