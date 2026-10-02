import { Suspense, useEffect, useState } from "react";
import useEditorStore from "../stores/useEditorStore";
import PanelLoading from "./PanelLoading";

function MountedPanel({ children, remember }) {
  useEffect(() => remember(true), [remember]);
  return children;
}

export default function DeferredPanel({ when, label, onClose, children }) {
  const active = useEditorStore(when);
  const [hasOpened, setHasOpened] = useState(false);

  if (!active && !hasOpened) return null;

  return (
    <Suspense fallback={active && label ? <PanelLoading label={label} onClose={onClose} /> : null}>
      <MountedPanel remember={setHasOpened}>{children}</MountedPanel>
    </Suspense>
  );
}
