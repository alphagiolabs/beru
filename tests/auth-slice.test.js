import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
  getSupabaseConfig: () => ({ isConfigured: true }),
}));

import { createAuthSlice } from "../src/stores/slices/authSlice.js";

function makeStore() {
  const state = createAuthSlice(
    (partial) => {
      Object.assign(state, typeof partial === "function" ? partial(state) : partial);
    },
    () => state,
  );
  return state;
}

describe("authSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initial state has authReady=false and session=null", () => {
    const s = makeStore();
    expect(s.authReady).toBe(false);
    expect(s.session).toBe(null);
    expect(s.user).toBe(null);
    expect(s.isAdmin).toBe(false);
  });

  it("initAuth resolves authReady=true when no session", async () => {
    const { supabase } = await import("../src/lib/supabaseClient.js");
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const s = makeStore();
    await s.initAuth();
    expect(s.authReady).toBe(true);
    expect(s.session).toBe(null);
  });

  it("initAuth sets session and fetches role when session exists", async () => {
    const { supabase } = await import("../src/lib/supabaseClient.js");
    const mockSession = { user: { id: "user-123", email: "test@test.com" } };
    supabase.auth.getSession.mockResolvedValue({ data: { session: mockSession } });
    supabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { role: "admin" } }),
        })),
      })),
    });
    const s = makeStore();
    await s.initAuth();
    expect(s.authReady).toBe(true);
    expect(s.session).toEqual(mockSession);
    expect(s.user).toEqual(mockSession.user);
    expect(s.isAdmin).toBe(true);
  });

  it("signIn calls supabase auth and returns error on failure", async () => {
    const { supabase } = await import("../src/lib/supabaseClient.js");
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid credentials" },
    });
    const s = makeStore();
    const res = await s.signIn("test@test.com", "wrongpass");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Invalid credentials");
  });

  it("signIn succeeds and sets session", async () => {
    const { supabase } = await import("../src/lib/supabaseClient.js");
    const mockSession = { user: { id: "user-123", email: "test@test.com" } };
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    supabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { role: "user" } }),
        })),
      })),
    });
    const s = makeStore();
    const res = await s.signIn("test@test.com", "correctpass");
    expect(res.ok).toBe(true);
    expect(s.session).toEqual(mockSession);
    expect(s.isAdmin).toBe(false);
  });

  it("signOut clears session and user", async () => {
    const { supabase } = await import("../src/lib/supabaseClient.js");
    supabase.auth.signOut.mockResolvedValue({ error: null });
    const s = makeStore();
    s.session = { user: { id: "x" } };
    s.user = { id: "x" };
    s.isAdmin = true;
    await s.signOut();
    expect(s.session).toBe(null);
    expect(s.user).toBe(null);
    expect(s.isAdmin).toBe(false);
  });
});
