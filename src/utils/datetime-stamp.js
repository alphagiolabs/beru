import { pickTextStyle } from "./text-style.js";
import { TEXT_STYLE_PRESETS } from "./types.js";

export const CLOCK_FORMATS = ["datetime", "date", "time"];
export const CLOCK_LAYOUTS = ["single", "split"];

export const DVR_STAMP_REGION = Object.freeze({ x: 0.103, y: 0.055, w: 0.621, h: 0.098 });
const DVR_BOX_TO_FONT = 1.66;

export function dvrStampFontSize(videoHeight) {
  return Math.max(
    8,
    Math.min(200, Math.round((DVR_STAMP_REGION.h * videoHeight) / DVR_BOX_TO_FONT)),
  );
}

export function dvrStampStyle(videoHeight) {
  const preset = TEXT_STYLE_PRESETS.find((p) => p.id === "fechero");
  return { ...pickTextStyle(preset), fontSize: dvrStampFontSize(videoHeight), textAlign: "left" };
}
export const CLOCK_DATE_STYLES = ["dmy", "mdy", "ymd"];

const MAX_CLOCK_EPOCH_MS = Date.UTC(10000, 0, 1);
const CLOCK_START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

function pickEnum(value, allowed) {
  return allowed.includes(value) ? value : allowed[0];
}

export function parseClockStart(value) {
  const match = CLOCK_START_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(ms);
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return roundTrips && ms >= 0 && ms < MAX_CLOCK_EPOCH_MS ? ms : null;
}

const pad = (value, size = 2) => String(value).padStart(size, "0");

export function clockStartFromDate(date) {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function normalizeClockFields(op = {}) {
  return {
    clockStart: parseClockStart(op.clockStart) == null ? "" : String(op.clockStart).trim(),
    clockFormat: pickEnum(op.clockFormat, CLOCK_FORMATS),
    clockLayout: pickEnum(op.clockLayout, CLOCK_LAYOUTS),
    clockDateStyle: pickEnum(op.clockDateStyle, CLOCK_DATE_STYLES),
  };
}

export function clockToJobPayload(op = {}) {
  const clock = normalizeClockFields(op);
  const ms = parseClockStart(clock.clockStart);
  return {
    clock_start_epoch: ms == null ? null : ms / 1000,
    clock_format: clock.clockFormat,
    clock_layout: clock.clockLayout,
    clock_date_style: clock.clockDateStyle,
  };
}

export function formatClockBlocks(op, sourceSeconds) {
  const clock = normalizeClockFields(op);
  const ms = parseClockStart(clock.clockStart);
  if (ms == null) return [];
  const seconds = Math.floor(ms / 1000 + Math.max(0, Number(sourceSeconds) || 0));
  const d = new Date(seconds * 1000);
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  const year = pad(d.getUTCFullYear(), 4);
  const date = {
    dmy: `${day}/${month}/${year}`,
    mdy: `${month}/${day}/${year}`,
    ymd: `${year}/${month}/${day}`,
  }[clock.clockDateStyle];
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const blocks = [];
  if (clock.clockFormat !== "time") blocks.push(date);
  if (clock.clockFormat !== "date") blocks.push(time);
  return clock.clockLayout === "single" && blocks.length > 1 ? [blocks.join(" ")] : blocks;
}

export function splitClockRegion(region, lengths, fontSize, inset) {
  const count = lengths.length;
  if (count <= 1) return count ? [{ ...region }] : [];
  const gap = Math.max(2, Math.round(Number(fontSize) * 0.3));
  const inner = Math.max(0, region.w - gap * (count - 1) - 2 * inset * count);
  const total = lengths.reduce((sum, n) => sum + n, 0) || 1;
  const boxes = [];
  let x = region.x;
  lengths.forEach((length, index) => {
    const w =
      index === count - 1
        ? region.x + region.w - x
        : 2 * inset + Math.round((inner * length) / total);
    boxes.push({ x, y: region.y, w: Math.max(0, w), h: region.h });
    x += w + gap;
  });
  return boxes;
}
