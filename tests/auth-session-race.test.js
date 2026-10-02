import { create } from "zustand";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null }));
vi.mock("../src/lib/supabaseClient.js", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => mocks.client,
}));
let createAuthSlice;
beforeEach(async () => {
  vi.resetModules();
  ({ createAuthSlice } = await import("../src/stores/slices/authSlice.js"));
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(profilePromise) {
  let listener;
  const session = { user: { id: "old-user" } };
  mocks.client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async () => ({ data: { user: session.user }, error: null }),
      signOut: async () => {},
      onAuthStateChange: (callback) => {
        listener = callback;
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profilePromise }) }) }),
  };
  return { store: create(createAuthSlice), emit: (...args) => listener(...args), session };
}

afterEach(() => vi.useRealTimers());

describe("auth session ownership", () => {
  it.each(["initAuth", "signIn"])(
    "does not restore a user when %s resolves after logout",
    async (action) => {
      const pending = deferred();
      const { store } = setup(pending.promise);
      const work = store.getState()[action]("user@example.com", "password");
      await Promise.resolve();
      await store.getState().signOut();
      pending.resolve({ data: { id: "old-user", is_active: true }, error: null });
      await work;
      expect(store.getState()).toMatchObject({
        authStatus: "unauthenticated",
        user: null,
        profile: null,
      });
    },
  );

  it("invalidates an auth event profile fetch as soon as a signed-out event arrives", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const { store, emit, session } = setup(
      Promise.resolve({ data: { id: "old-user", is_active: true } }),
    );
    await store.getState().initAuth();
    mocks.client.from = () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => pending.promise }) }),
    });
    emit("TOKEN_REFRESHED", session);
    await vi.advanceTimersByTimeAsync(0);
    emit("SIGNED_OUT", null);
    await vi.advanceTimersByTimeAsync(0);
    pending.resolve({ data: { id: "old-user", is_active: true }, error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState()).toMatchObject({
      authStatus: "unauthenticated",
      user: null,
      profile: null,
    });
  });
});
