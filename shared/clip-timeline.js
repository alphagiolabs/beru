export const IDENTITY_TIMING = { rate: 1, repeatCount: 1 };
export const MAX_REPEAT_COUNT = 20;
export const MAX_OUTPUT_DURATION = 7200;
export function playbackRates(current = 1) {
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  if (!rates.includes(current)) rates.push(current);
  return rates.sort((a, b) => a - b);
}

export function normalizeTiming(value) {
  const rate = Number(value?.rate);
  const repeatCount = Number(value?.repeatCount);
  return {
    rate:
      typeof value?.rate !== "boolean" && Number.isFinite(rate) && rate >= 0.25 && rate <= 4
        ? rate
        : 1,
    repeatCount:
      Number.isInteger(repeatCount) && repeatCount >= 1 && repeatCount <= MAX_REPEAT_COUNT
        ? repeatCount
        : 1,
  };
}

export function clipTimeline(item) {
  const { rate, repeatCount } = normalizeTiming(item?.timing);
  const duration = Math.max(0, Number(item?.duration) || 0);
  const start = Math.min(duration, Math.max(0, Number(item?.trimStart) || 0));
  const end = Math.min(
    duration,
    item?.trimEnd == null ? duration : Math.max(start, Number(item.trimEnd) || 0),
  );
  const cycleDuration = (end - start) / rate;
  return {
    rate,
    repeatCount,
    start,
    end,
    cycleDuration,
    totalDuration: cycleDuration * repeatCount,
    sourceToOutput(time, cycle = 0) {
      return time >= start && time <= end && cycle >= 0 && cycle < repeatCount
        ? (time - start) / rate + cycle * cycleDuration
        : null;
    },
  };
}
