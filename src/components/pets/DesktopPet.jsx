import { useCallback, useEffect, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { useT } from "../../i18n/useT";
import PetSprite from "./PetSprite.jsx";

const DRAG_SCALE = 0.55;

function defaultCornerPosition() {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return {
    x: Math.max(16, window.innerWidth - 132),
    y: Math.max(16, window.innerHeight - 132),
  };
}

export default function DesktopPet() {
  const t = useT();
  const petEnabled = useEditorStore((s) => s.petEnabled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petPosition = useEditorStore((s) => s.petPosition);
  const petSpritesheet = useEditorStore((s) => s.petSpritesheet);
  const loadPetSpritesheet = useEditorStore((s) => s.loadPetSpritesheet);
  const setPetPosition = useEditorStore((s) => s.setPetPosition);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const showSettings = useEditorStore((s) => s.showSettings);

  const [dragging, setDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState(null);
  const [petState, setPetState] = useState("idle");
  const dragOffset = useRef({ x: 0, y: 0 });
  const nodeRef = useRef(null);
  const wasProcessingRef = useRef(false);

  useEffect(() => {
    if (!petEnabled || !petActiveSlug) return;
    loadPetSpritesheet(petActiveSlug);
  }, [petEnabled, petActiveSlug, loadPetSpritesheet]);

  useEffect(() => {
    if (isProcessing) {
      setPetState("running");
      wasProcessingRef.current = true;
      return undefined;
    }

    if (wasProcessingRef.current) {
      wasProcessingRef.current = false;
      setPetState("waving");
      const timer = setTimeout(() => setPetState("idle"), 2200);
      return () => clearTimeout(timer);
    }

    setPetState("idle");
    return undefined;
  }, [isProcessing]);

  const position = dragPosition ?? petPosition ?? defaultCornerPosition();

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      const node = nodeRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      dragOffset.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setDragging(true);
      setDragPosition(position);
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [position],
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!dragging) return;
      setDragPosition({
        x: Math.max(0, event.clientX - dragOffset.current.x),
        y: Math.max(0, event.clientY - dragOffset.current.y),
      });
    },
    [dragging],
  );

  const onPointerUp = useCallback(
    (event) => {
      if (dragPosition) {
        void setPetPosition(dragPosition);
      }
      setDragging(false);
      setDragPosition(null);
      nodeRef.current?.releasePointerCapture(event.pointerId);
    },
    [dragPosition, setPetPosition],
  );

  if (!petEnabled || !petActiveSlug || !petSpritesheet || showSettings) return null;

  return (
    <div
      ref={nodeRef}
      className={`desktop-pet${dragging ? " desktop-pet--dragging" : ""}`}
      style={{ left: position.x, top: position.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        setPetEnabled(false);
      }}
      title={t("settings.petdex.hidePetHint")}
    >
      <PetSprite src={petSpritesheet} state={petState} scale={DRAG_SCALE} />
    </div>
  );
}
