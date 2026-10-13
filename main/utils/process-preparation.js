let generation = 0;
export const captureProcessingPreparation = () => generation;
export const isProcessingPreparationCurrent = (token) => token === generation;
export const cancelProcessingPreparation = () => {
  generation += 1;
};
