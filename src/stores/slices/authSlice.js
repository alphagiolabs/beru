import { getSupabase, isSupabaseConfigured } from "../../lib/supabaseClient.js";

let _authListenerRegistered = false;

export function profileGateError(profile) {
  if (!profile) return "auth.profileMissing";
  if (!profile.is_active) return "auth.accountDisabled";
  return null;
}

async function fetchProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function applySession(supabase, set, nextSession, isCurrent) {
  if (!isCurrent()) return { ok: false, reason: "superseded" };
  if (!nextSession?.user) {
    set({ authStatus: "unauthenticated", user: null, profile: null });
    return { ok: false, reason: "no-session" };
  }
  try {
    const nextProfile = await fetchProfile(supabase, nextSession.user.id);
    if (!isCurrent()) return { ok: false, reason: "superseded" };
    const gate = profileGateError(nextProfile);
    if (gate) {
      set({
        authStatus: "unauthenticated",
        user: null,
        profile: null,
        authError: gate,
      });
      await supabase.auth.signOut();
      return {
        ok: false,
        reason: gate === "auth.accountDisabled" ? "disabled" : "no-profile",
        error: gate,
      };
    }
    set({
      authStatus: "authenticated",
      user: nextSession.user,
      profile: nextProfile,
      authError: null,
    });
    return { ok: true };
  } catch {
    if (!isCurrent()) return { ok: false, reason: "superseded" };
    set({
      authStatus: "unauthenticated",
      user: null,
      profile: null,
      authError: "auth.profileFetchFailed",
    });
    return { ok: false, reason: "error", error: "auth.profileFetchFailed" };
  }
}

/**
 * Defer Supabase calls until onAuthStateChange releases its lock to avoid deadlock.
 * @see https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
 */
function ensureAuthListener(supabase, set, beginSession, invalidateActions) {
  if (_authListenerRegistered || !supabase) return;
  _authListenerRegistered = true;
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (!nextSession?.user) invalidateActions();
    const isCurrent = beginSession();
    setTimeout(() => {
      void applySession(supabase, set, nextSession, isCurrent);
    }, 0);
  });
}

export function createAuthSlice(set, get) {
  let sessionGeneration = 0;
  let actionGeneration = 0;
  const invalidateActions = () => ++actionGeneration;
  const beginSession = () => {
    const generation = ++sessionGeneration;
    return () => generation === sessionGeneration;
  };
  const registerListener = (supabase) =>
    ensureAuthListener(supabase, set, beginSession, invalidateActions);
  return {
    authStatus: isSupabaseConfigured ? "loading" : "unauthenticated",
    user: null,
    profile: null,
    authError: null,

    initAuth: async () => {
      if (!isSupabaseConfigured) {
        set({ authStatus: "unauthenticated", authError: "auth.notConfigured" });
        return { ok: false, reason: "not-configured" };
      }

      const supabase = getSupabase();
      registerListener(supabase);
      invalidateActions();
      const isCurrent = beginSession();
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return await applySession(supabase, set, session, isCurrent);
      } catch (err) {
        if (!isCurrent()) return { ok: false, reason: "superseded" };
        set({
          authStatus: "unauthenticated",
          user: null,
          profile: null,
          authError: err?.message || "auth.profileFetchFailed",
        });
        return { ok: false, reason: "error" };
      }
    },

    signIn: async (email, password) => {
      const supabase = getSupabase();
      if (!supabase) return { ok: false, error: "auth.notConfigured" };
      registerListener(supabase);
      const action = invalidateActions();
      beginSession();
      set({ authError: null });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (action !== actionGeneration) return { ok: false, reason: "superseded" };
      if (error) {
        const code = error.message?.toLowerCase().includes("invalid")
          ? "auth.invalidCredentials"
          : error.message;
        set({ authError: code });
        return { ok: false, error: code };
      }
      return applySession(supabase, set, { user: data.user }, beginSession());
    },

    signOut: async () => {
      const supabase = getSupabase();
      invalidateActions();
      beginSession();
      set({ authStatus: "unauthenticated", user: null, profile: null, authError: null });
      if (supabase) await supabase.auth.signOut();
      return { ok: true };
    },

    listUsers: async () => {
      const supabase = getSupabase();
      const { profile } = get();
      if (!supabase || profile?.role !== "admin") return { ok: false, error: "auth.forbidden" };

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active, created_at")
        .order("created_at", { ascending: false });

      if (error) return { ok: false, error: error.message };
      return { ok: true, users: data || [] };
    },

    createUser: async ({ email, password, fullName }) => {
      const supabase = getSupabase();
      const { profile } = get();
      if (!supabase || profile?.role !== "admin") return { ok: false, error: "auth.forbidden" };

      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: {
          action: "create",
          email,
          password,
          full_name: fullName,
        },
      });

      if (error) return { ok: false, error: error.message };
      if (data?.error) return { ok: false, error: data.error };
      return { ok: true, user: data?.user };
    },

    toggleUserActive: async (userId, isActive) => {
      const supabase = getSupabase();
      const { profile, user } = get();
      if (!supabase || profile?.role !== "admin") return { ok: false, error: "auth.forbidden" };
      if (userId === user?.id && !isActive) return { ok: false, error: "auth.cannotDisableSelf" };

      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "toggle_active", user_id: userId, is_active: isActive },
      });

      if (error) return { ok: false, error: error.message };
      if (data?.error) return { ok: false, error: data.error };
      return { ok: true };
    },
  };
}
