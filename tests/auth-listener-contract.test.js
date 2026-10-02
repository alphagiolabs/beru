import { create } from "zustand";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null }));
vi.mock("../src/lib/supabaseClient.js", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => mocks.client,
}));

let createAuthSlice;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  ({ createAuthSlice } = await import("../src/stores/slices/authSlice.js"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup() {
  let listener;
  let locked = false;
  const session = { user: { id: "user" } };
  const fetchProfile = vi.fn(async () => {
    if (locked) throw new Error("Auth SDK lock is held");
    return { data: { id: "user", is_active: true }, error: null };
  });
  mocks.client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async () => ({ data: { user: session.user }, error: null }),
      signOut: async () => {},
      onAuthStateChange: (callback) => {
        listener = callback;
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: fetchProfile }) }) }),
  };
  return {
    store: create(createAuthSlice),
    session,
    fetchProfile,
    emit: (event, value) => listener(event, value),
    lock: (value) => {
      locked = value;
    },
  };
}

describe("auth listener lifecycle", () => {
  it("receives a later login after cold start without a session", async () => {
    const { store, emit, session } = setup();
    await store.getState().initAuth();
    expect(store.getState().authStatus).toBe("unauthenticated");
    emit("SIGNED_IN", session);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ authStatus: "authenticated", user: session.user });
  });

  it("receives logout events when signIn is called before initialization", async () => {
    const { store, emit } = setup();
    expect(await store.getState().signIn("user@example.com", "password")).toEqual({ ok: true });
    emit("SIGNED_OUT", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({
      authStatus: "unauthenticated",
      user: null,
      profile: null,
    });
  });

  it("does profile work only after the SDK auth callback releases its lock", async () => {
    const { store, emit, session, fetchProfile, lock } = setup();
    await store.getState().initAuth();
    lock(true);
    expect(emit("SIGNED_IN", session)).toBeUndefined();
    expect(fetchProfile).not.toHaveBeenCalled();
    lock(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().authStatus).toBe("authenticated");
  });
});
