import { beruLocalUrl as localUrl } from "../../../utils/beru-url.js";

export function beruLocalUrl(filePath) {
  return filePath ? localUrl(filePath) : null;
}
