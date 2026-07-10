import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(process.cwd(), "src/stores/slices/authSlice.js"), "utf-8");

describe("auth listener registration contract", () => {
  it("defines ensureAuthListener helper", () => {
    expect(src).toMatch(/function ensureAuthListener/);
  });

  it("initAuth registers the listener before handling no-session", () => {
    const initStart = src.indexOf("initAuth: async");
    const initBody = src.slice(initStart, src.indexOf("signIn: async"));
    const ensureIdx = initBody.indexOf("ensureAuthListener");
    const noSessionIdx = initBody.indexOf("no-session");
    expect(ensureIdx).toBeGreaterThanOrEqual(0);
    expect(noSessionIdx).toBeGreaterThan(ensureIdx);
  });

  it("signIn also ensures the listener is registered", () => {
    const signInStart = src.indexOf("signIn: async");
    const signInBody = src.slice(signInStart, src.indexOf("signOut: async"));
    expect(signInBody).toMatch(/ensureAuthListener/);
  });

  // supabase-js deadlocks if onAuthStateChange is async and awaits client APIs
  // while getSession/signIn hold the same lock — boot freezes on "Verificando sesión".
  it("defers async session work out of onAuthStateChange (no deadlock)", () => {
    expect(src).not.toMatch(/onAuthStateChange\(\s*async\b/);
    expect(src).toMatch(/onAuthStateChange\s*\(\s*\([^)]*\)\s*=>\s*\{/);
    const ensureStart = src.indexOf("function ensureAuthListener");
    const ensureBody = src.slice(ensureStart, src.indexOf("export function createAuthSlice"));
    expect(ensureBody).toMatch(/setTimeout\s*\(/);
    expect(ensureBody).toMatch(/applySession/);
  });
});
