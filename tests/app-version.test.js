import { describe, it, expect } from "vitest";
import {
  APP_VERSION,
  formatFooterClock,
  parseReleaseNotesSections,
} from "../src/utils/appVersion.js";

describe("appVersion utils", () => {
  it("exposes the package version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("parses release notes into bullet lines", () => {
    const { whatsNew } = parseReleaseNotesSections("<p>Fix #123</p>\n- Better queue\n* Footer", 6);
    expect(whatsNew).toEqual(["Fix #123", "Better queue", "Footer"]);
  });

  it("groups release notes into changelog sections", () => {
    expect(
      parseReleaseNotesSections(
        "What's new\n- feat: queue overhaul\n- Better footer\nFixed\n- fix: batch queue\n- fix: footer",
        2,
      ),
    ).toEqual({
      whatsNew: ["feat: queue overhaul", "Better footer"],
      fixed: ["fix: batch queue", "fix: footer"],
      hiddenCount: 0,
    });
  });

  it("classifies conventional commit prefixes when no section headers exist", () => {
    expect(parseReleaseNotesSections("- fix: startup status\n- feat: new footer")).toEqual({
      whatsNew: ["feat: new footer"],
      fixed: ["fix: startup status"],
      hiddenCount: 0,
    });
  });

  it("formats elapsed time for footer clocks", () => {
    expect(formatFooterClock(125000)).toBe("02:05");
    expect(formatFooterClock(3725000)).toBe("1:02:05");
  });
});
