/** @typedef {import("./pet-states.js").PetStateId} PetStateId */

/**
 * Hermes-style activity resolver for Beru.
 *
 * @param {{
 *   isProcessing?: boolean,
 *   confirmOpen?: boolean,
 *   updateDownloading?: boolean,
 *   celebration?: PetStateId | null,
 * }} signals
 * @returns {PetStateId}
 */
export function resolvePetActivity(signals) {
  if (signals.celebration) return signals.celebration;
  if (signals.confirmOpen) return "waiting";
  if (signals.updateDownloading) return "review";
  if (signals.isProcessing) return "running";
  return "idle";
}

/**
 * @param {{ total?: number, succeeded?: number, failed?: number } | null | undefined} summary
 * @returns {PetStateId | null}
 */
export function resolveBatchCelebration(summary) {
  if (!summary) return null;
  const total = Number(summary.total) || 0;
  const succeeded = Number(summary.succeeded) || 0;
  const failed = Number(summary.failed) || 0;
  if (total <= 0 && succeeded <= 0 && failed <= 0) return null;
  if (failed > 0) return "failed";
  if (succeeded > 0 && failed === 0 && total > 0 && succeeded === total) return "jumping";
  if (succeeded > 0) return "waving";
  return null;
}

/** @param {PetStateId} stateId */
export function celebrationDurationMs(stateId) {
  switch (stateId) {
    case "failed":
      return 2500;
    case "jumping":
      return 2800;
    case "waving":
      return 2200;
    default:
      return 2000;
  }
}

/** @param {PetStateId} stateId */
export function petBubbleKey(stateId) {
  switch (stateId) {
    case "running":
      return "settings.petdex.bubbleWorking";
    case "review":
      return "settings.petdex.bubbleThinking";
    case "waiting":
      return "settings.petdex.bubbleYourTurn";
    case "failed":
      return "settings.petdex.bubbleFailed";
    case "jumping":
    case "waving":
      return "settings.petdex.bubbleDone";
    default:
      return null;
  }
}
