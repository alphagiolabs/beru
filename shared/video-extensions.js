export const INPUT_VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "flv",
  "wmv",
  "m4v",
  "mpg",
  "mpeg",
];

export const VIDEO_EXT = new RegExp(`\\.(${INPUT_VIDEO_EXTENSIONS.join("|")})$`, "i");

export const OUTPUT_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
