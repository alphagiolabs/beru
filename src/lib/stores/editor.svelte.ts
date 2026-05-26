/**
 * Editor utilities (pure functions, no Svelte state).
 * State stays in the component; these functions compute values.
 */
import type { Operation } from '$lib/video-utils';

/** Snapshot of text style fields into an Operation partial. */
export function buildTextStyle(params: {
  textInput: string; textFontSize: number; textFontColor: string;
  tempStart: number | null; tempEnd: number | null;
}): Partial<Operation> {
  return {
    text: params.textInput,
    fontSize: params.textFontSize,
    fontColor: params.textFontColor,
    startTime: params.tempStart,
    endTime: params.tempEnd,
  };
}
