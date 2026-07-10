import { useCallback, useEffect, useRef, useState } from "react";
import PetSprite from "./PetSprite.jsx";

function defaultCornerPosition() {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return {
    x: Math.max(16, window.innerWidth - 132),
    y: Math.max(16, window.innerHeight - 132),
  };
}

/**
 * @param {{
 *   state: import("../utils/pet-states.js").PetStateId,
 *   spritesheet: string,
 *   scale: number,
 *   opacity?: number,
 *   movement?: string,
 *   position?: { x: number, y: number } | null,
 *   onPositionChange?: (position: { x: number, y: number }) => void,
 *   onShiftClick?: () => void,
 *   onContextMenu?: () => void,
 *   title?: string,
 *   className?: string,
 * }} props
 */
export default function PetSurface({
  state,
  spritesheet,
  scale,
  opacity = 1.0,
  movement = "fijo",
  position = null,
  onPositionChange,
  onShiftClick,
  onContextMenu,
  title,
  className = "",
}) {
  const [dragging, setDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const nodeRef = useRef(null);

  // Lógica de caminar
  const [walkPos, setWalkPos] = useState(null);
  const [walkState, setWalkState] = useState(null);
  const isDraggingRef = useRef(false);
  const posRef = useRef(position ?? defaultCornerPosition());
  const targetRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!dragging && position) {
      posRef.current = position;
      setWalkPos(position);
    }
  }, [position, dragging]);

  const resolvedPosition =
    dragging && dragPosition ? dragPosition : (walkPos ?? position ?? defaultCornerPosition());

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      if (event.shiftKey) {
        event.preventDefault();
        onShiftClick?.();
        return;
      }
      const node = nodeRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      dragOffset.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      isDraggingRef.current = true;
      setDragging(true);
      setDragPosition(resolvedPosition);
      nodeRef.current.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [onShiftClick, resolvedPosition],
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
      if (dragPosition && onPositionChange) {
        onPositionChange(dragPosition);
        posRef.current = dragPosition;
      }
      isDraggingRef.current = false;
      setDragging(false);
      setDragPosition(null);
      nodeRef.current?.releasePointerCapture(event.pointerId);
    },
    [dragPosition, onPositionChange],
  );

  useEffect(() => {
    if (movement !== "caminar") {
      setWalkState(null);
      targetRef.current = null;
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
      return;
    }

    let lastTime = performance.now();

    const pickTarget = () => {
      if (typeof window === "undefined") return null;
      return {
        x: Math.random() * Math.max(0, window.innerWidth - 100),
        y: Math.random() * Math.max(0, window.innerHeight - 100),
      };
    };

    const loop = (time) => {
      timerRef.current = requestAnimationFrame(loop);

      if (isDraggingRef.current) {
        lastTime = time;
        return;
      }

      const dt = time - lastTime;
      if (dt < 16) return;
      lastTime = time;

      if (!targetRef.current) {
        if (Math.random() < 0.01) {
          targetRef.current = pickTarget();
        } else {
          setWalkState(null);
        }
        return;
      }

      const tx = targetRef.current.x;
      const ty = targetRef.current.y;
      let cx = posRef.current.x;
      let cy = posRef.current.y;

      const dx = tx - cx;
      const dy = ty - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < 5) {
        targetRef.current = null;
        setWalkState(null);
      } else {
        const speed = 1.5;
        cx += (dx / dist) * speed;
        cy += (dy / dist) * speed;
        posRef.current = { x: cx, y: cy };
        setWalkPos({ x: cx, y: cy });
        setWalkState(dx > 0 ? "running-right" : "running-left");
      }
    };

    timerRef.current = requestAnimationFrame(loop);
    return () => {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, [movement]);

  const displayState = walkState ?? state;

  return (
    <div
      ref={nodeRef}
      className={`pet-surface${dragging ? " pet-surface--dragging" : ""} ${className}`.trim()}
      style={{ left: resolvedPosition.x, top: resolvedPosition.y, opacity }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.();
      }}
      title={title}
    >
      <PetSprite src={spritesheet} state={displayState} scale={scale} />
    </div>
  );
}
