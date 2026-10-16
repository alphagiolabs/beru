let generation = 0;
const owners = new Map();
export const captureProcessingPreparation = (owner = null) => ({
  generation,
  owner,
  ownerGeneration: owners.get(owner) ?? 0,
});
export const isProcessingPreparationCurrent = (token) =>
  token.generation === generation && token.ownerGeneration === (owners.get(token.owner) ?? 0);
export const cancelProcessingPreparation = (owner = null) => {
  if (owner) owners.set(owner, (owners.get(owner) ?? 0) + 1);
  else {
    generation += 1;
    owners.clear();
  }
};
