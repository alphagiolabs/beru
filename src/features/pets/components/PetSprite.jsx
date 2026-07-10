import { memo } from "react";
import { ATLAS_SHEET_HEIGHT, ATLAS_SHEET_WIDTH, resolvePetState } from "../utils/pet-states.js";

/**
 * @param {{
 *   src: string,
 *   state?: import("../utils/pet-states.js").PetStateId,
 *   scale?: number,
 *   label?: string,
 *   className?: string,
 * }} props
 */
function PetSpriteImpl({ src, state = "idle", scale = 1, label, className = "" }) {
  const animation = resolvePetState(state);

  return (
    <div
      className={`pet-sprite-frame ${className}`}
      role="img"
      aria-label={label ?? "Pet animation"}
      style={{ "--pet-scale": scale }}
    >
      <div
        className="pet-sprite"
        style={{
          "--sprite-url": `url("${src.replace(/"/g, '\\"')}")`,
          "--sprite-row": animation.row,
          "--sprite-frames": animation.frames,
          "--sprite-duration": `${animation.durationMs}ms`,
          "--sprite-sheet-width": `${ATLAS_SHEET_WIDTH}px`,
          "--sprite-sheet-height": `${ATLAS_SHEET_HEIGHT}px`,
        }}
      />
    </div>
  );
}

export default memo(PetSpriteImpl);
