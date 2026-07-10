import { useCallback, useEffect, useRef, useState } from "react";
import PetSprite from "./features/pets/components/PetSprite.jsx";
import { petBubbleKey } from "./features/pets/utils/pet-activity.js";
import { tStatic } from "./utils/format-message.js";
import "./features/pets/pets.css";

const DEFAULT_STATE = {
  enabled: false,
  slug: null,
  spritesheet: null,
  scale: 0.33,
  state: "idle",
  language: "es",
};

export default function PetOverlayApp() {
  const [overlayState, setOverlayState] = useState(DEFAULT_STATE);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const api = window.api;
    if (!api?.onPetOverlayState) return undefined;

    const unsub = api.onPetOverlayState((payload) => {
      if (!payload || typeof payload !== "object") return;
      setOverlayState((current) => ({ ...current, ...payload }));
    });

    void api.getPetOverlayState?.().then((res) => {
      if (res?.success && res.state) {
        setOverlayState((current) => ({ ...current, ...res.state }));
      }
    });

    return unsub;
  }, []);

  const handleShiftClick = useCallback(() => {
    void window.api?.popInPetOverlay?.();
  }, []);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      if (event.shiftKey) {
        event.preventDefault();
        handleShiftClick();
        return;
      }
      dragOrigin.current = { x: event.screenX, y: event.screenY };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [handleShiftClick],
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!dragging) return;
      const dx = event.screenX - dragOrigin.current.x;
      const dy = event.screenY - dragOrigin.current.y;
      if (dx === 0 && dy === 0) return;
      dragOrigin.current = { x: event.screenX, y: event.screenY };
      void window.api?.dragPetOverlayBy?.({ dx, dy });
    },
    [dragging],
  );

  const onPointerUp = useCallback((event) => {
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  if (!overlayState.enabled || !overlayState.spritesheet) {
    return null;
  }

  const bubbleKey = petBubbleKey(overlayState.state);
  const bubble = bubbleKey ? tStatic(bubbleKey, {}, overlayState.language || "es") : null;

  return (
    <div
      className={`pet-overlay-root${dragging ? " pet-overlay-root--dragging" : ""}`}
      style={{ opacity: overlayState.opacity ?? 1.0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={tStatic("settings.petdex.popInHint", {}, overlayState.language || "es")}
    >
      {bubble ? <div className="pet-surface-bubble">{bubble}</div> : null}
      <PetSprite
        src={overlayState.spritesheet}
        state={overlayState.state}
        scale={overlayState.scale}
      />
    </div>
  );
}
