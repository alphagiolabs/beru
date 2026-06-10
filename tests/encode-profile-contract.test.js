import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import contract from "../resources/encode-profiles.json" with { type: "json" };
import {
  ENCODE_PROFILES,
  getEffectiveHwEncoder,
  profileAllowsHardware,
  normalizeEncodeProfile,
} from "../main/encodeProfiles.js";
import { resolveBatchWorkers } from "../main/workerPolicy.js";

const PY = process.platform === "win32" ? "python" : "python3";

const hasPython = (() => {
  try {
    const r = spawnSync(PY, ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const describeIfPython = hasPython ? describe : describe.skip;
const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

describe("encode profile contract (JSON)", () => {
  it("quality allows high-fidelity hardware encoding", () => {
    expect(contract.profiles.quality.allowsHardware).toBe(true);
    expect(contract.profiles.quality.hardware).toEqual({ hwCq: 18, nvencPreset: "p6" });
    expect(contract.profiles.quality._comment).toContain("CQ 18");
    expect(contract.profiles.quality._comment).toContain("CRF 18");
    expect(contract.profiles.fast.allowsHardware).toBe(true);
    expect(contract.profiles.balanced.allowsHardware).toBe(true);
  });

  it("software encode params live only in the JSON", () => {
    expect(ENCODE_PROFILES.quality.crf).toBe(contract.profiles.quality.software.crf);
    expect(ENCODE_PROFILES.quality.hwCq).toBe(contract.profiles.quality.hardware.hwCq);
    expect(ENCODE_PROFILES.quality.nvencPreset).toBe(
      contract.profiles.quality.hardware.nvencPreset,
    );
    expect(ENCODE_PROFILES.balanced.hwCq).toBe(contract.profiles.balanced.hardware.hwCq);
    expect(ENCODE_PROFILES.uquality.crf).toBe(contract.profiles.uquality.software.crf);
    expect(ENCODE_PROFILES.uquality.preset).toBe(contract.profiles.uquality.software.preset);
  });

  it("U Quality is a CPU-only ultra fidelity profile", () => {
    expect(contract.profiles.uquality.allowsHardware).toBe(false);
    expect(contract.profiles.uquality.software).toEqual({ crf: 12, preset: "slow" });
    expect(contract.profiles.uquality.hardware).toBeUndefined();
    expect(contract.profiles.uquality._comment).toContain("CRF 12");
  });
});

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

  it("resolveBatchWorkers applies balanced GPU caps to quality + filters", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        maxSourcePixels: 1920 * 1080,
        mode: "balanced",
        hasVideoFilters: true,
        encodeProfile: "quality",
      }),
    ).toBe(3);
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
