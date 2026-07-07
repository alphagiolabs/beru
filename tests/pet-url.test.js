import { describe, expect, it } from "vitest";
import { beruLocalUrl } from "../src/utils/pet-url.js";

describe("beruLocalUrl", () => {
  it("returns null for empty paths", () => {
    expect(beruLocalUrl(null)).toBeNull();
    expect(beruLocalUrl("")).toBeNull();
  });

  it("encodes local file paths for the beru protocol", () => {
    expect(beruLocalUrl("C:\\pets\\boba\\spritesheet.webp")).toBe(
      "beru://local/C%3A%5Cpets%5Cboba%5Cspritesheet.webp",
    );
  });
});
