import { describe, it, expect, vi, beforeEach } from "vitest";

describe("supabaseClient config guards", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getSupabaseConfig returns url and anonKey from VITE env", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const { getSupabaseConfig } = await import("../src/lib/supabaseClient.js");
    const cfg = getSupabaseConfig();
    expect(cfg.url).toBe("https://test.supabase.co");
    expect(cfg.anonKey).toBe("test-anon-key");
  });

  it("getSupabaseConfig returns isConfigured=false when env vars are absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { getSupabaseConfig } = await import("../src/lib/supabaseClient.js");
    const cfg = getSupabaseConfig();
    expect(cfg.isConfigured).toBe(false);
  });

  it("supabase client is null when not configured (no throw)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { supabase } = await import("../src/lib/supabaseClient.js");
    expect(supabase).toBe(null);
  });
});
