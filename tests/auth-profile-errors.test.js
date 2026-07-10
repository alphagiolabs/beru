import { describe, it, expect } from "vitest";
import { profileGateError } from "../src/stores/slices/authSlice.js";

describe("profileGateError", () => {
  it("reports missing profile separately from disabled", () => {
    expect(profileGateError(null)).toBe("auth.profileMissing");
    expect(profileGateError(undefined)).toBe("auth.profileMissing");
  });

  it("reports disabled when is_active is false", () => {
    expect(profileGateError({ is_active: false })).toBe("auth.accountDisabled");
  });

  it("returns null for an active profile", () => {
    expect(profileGateError({ is_active: true, role: "user" })).toBeNull();
  });
});
