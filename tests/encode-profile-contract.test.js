import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import {
  ENCODE_PROFILES,
  getEffectiveHwEncoder,
  profileAllowsHardware,
  normalizeEncodeProfile,
} from "../main/encodeProfiles.js";
import { describeIfPython } from "./helpers/python.js";

const PY = "python";

const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

describe("encode profile contract (JS helpers)", () => {
  it("getEffectiveHwEncoder allows hardware for quality", () => {
    expect(getEffectiveHwEncoder("quality", "h264_nvenc")).toBe("h264_nvenc");
    expect(getEffectiveHwEncoder("balanced", "h264_nvenc")).toBe("h264_nvenc");
  });

  it("profileAllowsHardware matches contract flags", () => {
    expect(profileAllowsHardware("quality")).toBe(true);
    expect(profileAllowsHardware("balanced")).toBe(true);
    expect(profileAllowsHardware("fast")).toBe(true);
    expect(profileAllowsHardware("uquality")).toBe(false);
  });

  it("normalizeEncodeProfile falls back unknown names to balanced", () => {
    expect(normalizeEncodeProfile("ultra")).toBe("balanced");
    expect(normalizeEncodeProfile("quality")).toBe("quality");
    expect(normalizeEncodeProfile("uquality")).toBe("uquality");
  });

  it("getEffectiveHwEncoder disables hardware for U Quality", () => {
    expect(getEffectiveHwEncoder("uquality", "h264_nvenc")).toBeNull();
  });
});

describeIfPython("encode profile contract (Python parity)", () => {
  it("profile_allows_hardware and effective_hw_encoder match JS", () => {
    const code = `
import json
import encode_profiles as ep
print(json.dumps({
  "quality_allows_hw": ep.profile_allows_hardware("quality"),
  "balanced_allows_hw": ep.profile_allows_hardware("balanced"),
  "uquality_allows_hw": ep.profile_allows_hardware("uquality"),
  "quality_effective_hw": ep.effective_hw_encoder("quality", "h264_nvenc"),
  "balanced_effective_hw": ep.effective_hw_encoder("balanced", "h264_nvenc"),
  "uquality_effective_hw": ep.effective_hw_encoder("uquality", "h264_nvenc"),
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({
      quality_allows_hw: true,
      balanced_allows_hw: true,
      uquality_allows_hw: false,
      quality_effective_hw: "h264_nvenc",
      balanced_effective_hw: "h264_nvenc",
      uquality_effective_hw: null,
    });
  });

  it("normalizes the JSON contract the same way in JS and Python", () => {
    const code = `
import json
import encode_profiles as ep
print(json.dumps(ep.ENCODE_PROFILES, sort_keys=True))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const pythonProfiles = JSON.parse(r.stdout.trim());
    expect(pythonProfiles).toEqual({
      fast: {
        crf: ENCODE_PROFILES.fast.crf,
        preset: ENCODE_PROFILES.fast.preset,
        allows_hardware: ENCODE_PROFILES.fast.allowsHardware,
        hw_cq: ENCODE_PROFILES.fast.hwCq,
        nvenc_preset: ENCODE_PROFILES.fast.nvencPreset,
      },
      balanced: {
        crf: ENCODE_PROFILES.balanced.crf,
        preset: ENCODE_PROFILES.balanced.preset,
        allows_hardware: ENCODE_PROFILES.balanced.allowsHardware,
        hw_cq: ENCODE_PROFILES.balanced.hwCq,
        nvenc_preset: ENCODE_PROFILES.balanced.nvencPreset,
      },
      quality: {
        crf: ENCODE_PROFILES.quality.crf,
        preset: ENCODE_PROFILES.quality.preset,
        allows_hardware: ENCODE_PROFILES.quality.allowsHardware,
        hw_cq: ENCODE_PROFILES.quality.hwCq,
        nvenc_preset: ENCODE_PROFILES.quality.nvencPreset,
      },
      uquality: {
        crf: ENCODE_PROFILES.uquality.crf,
        preset: ENCODE_PROFILES.uquality.preset,
        allows_hardware: ENCODE_PROFILES.uquality.allowsHardware,
      },
    });
  });
});
