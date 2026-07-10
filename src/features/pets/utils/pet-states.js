/** @typedef {"idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review"} PetStateId */

/** @type {ReadonlyArray<{ id: PetStateId, label: string, row: number, frames: number, durationMs: number }>} */
export const petStates = [
  { id: "idle", label: "Idle", row: 0, frames: 6, durationMs: 1100 },
  { id: "running-right", label: "Run Right", row: 1, frames: 8, durationMs: 1060 },
  { id: "running-left", label: "Run Left", row: 2, frames: 8, durationMs: 1060 },
  { id: "waving", label: "Waving", row: 3, frames: 4, durationMs: 700 },
  { id: "jumping", label: "Jumping", row: 4, frames: 5, durationMs: 840 },
  { id: "failed", label: "Failed", row: 5, frames: 8, durationMs: 1220 },
  { id: "waiting", label: "Waiting", row: 6, frames: 6, durationMs: 1010 },
  { id: "running", label: "Running", row: 7, frames: 6, durationMs: 820 },
  { id: "review", label: "Review", row: 8, frames: 6, durationMs: 1030 },
];

export const defaultPetState = petStates[0];

export const ATLAS_SHEET_WIDTH = 1536;
export const ATLAS_SHEET_HEIGHT = 1872;
export const PET_FRAME_WIDTH = 192;
export const PET_FRAME_HEIGHT = 208;

/** @param {PetStateId} stateId */
export function resolvePetState(stateId) {
  return petStates.find((item) => item.id === stateId) ?? defaultPetState;
}
