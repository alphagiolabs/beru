import { ATLAS_SHEET_HEIGHT, ATLAS_SHEET_WIDTH, resolvePetState } from "../utils/pet-states.js";

export default function StaticPetSprite({ src, state = "idle", scale = 1, label, className = "" }) {
  const spriteState = resolvePetState(state);

  return (
    <div
      className={`pet-sprite-frame ${className}`}
      role="img"
      aria-label={label ?? "Pet"}
      style={{ "--pet-scale": scale }}
    >
      <div
        className="pet-sprite-static"
        style={{
          "--sprite-url": `url("${src.replace(/"/g, '\\"')}")`,
          "--sprite-row": spriteState.row,
          "--sprite-sheet-width": `${ATLAS_SHEET_WIDTH}px`,
          "--sprite-sheet-height": `${ATLAS_SHEET_HEIGHT}px`,
        }}
      />
    </div>
  );
}
