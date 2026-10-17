import { Dialog } from "radix-ui";
import { useRef } from "react";
import { ModalCloseButton } from "./ui/ModalCloseButton";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { useT } from "../i18n/useT";

export default function MediaToolDialog({ open, onOpenChange, title, description, children }) {
  const t = useT();
  const opener = useRef(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cap-modal-overlay">
          <TooltipProvider>
            <Dialog.Content
              className="cap-modal-panel"
              style={{
                width: "min(900px, calc(100vw - 32px))",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
              onOpenAutoFocus={() => {
                opener.current = document.activeElement;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (opener.current?.isConnected) opener.current.focus();
              }}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
              }}
            >
              <div className="cap-modal-titlebar">
                <Dialog.Title className="cap-modal-title">{title}</Dialog.Title>
                <Tooltip label={t("common.close")}>
                  <Dialog.Close asChild>
                    <ModalCloseButton label={t("common.close")} />
                  </Dialog.Close>
                </Tooltip>
              </div>
              <Dialog.Description className="sr-only">{description}</Dialog.Description>
              {children}
            </Dialog.Content>
          </TooltipProvider>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
