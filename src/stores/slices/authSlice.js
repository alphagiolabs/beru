import { getSupabase, isSupabaseConfigured } from "../../lib/supabaseClient.js";

let _authListenerRegistered = false;

async function fetchProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Supabase auth session and admin user management. */
export function createAuthSlice(set, get) {
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
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          set({ authStatus: "unauthenticated", user: null, profile: null, authError: null });
          return { ok: false, reason: "no-session" };
        }

        const profile = await fetchProfile(supabase, session.user.id);
        if (!profile?.is_active) {
          await supabase.auth.signOut();
          set({
            authStatus: "unauthenticated",
            user: null,
            profile: null,
            authError: "auth.accountDisabled",
          });
          return { ok: false, reason: "disabled" };
        }

        set({
          authStatus: "authenticated",
          user: session.user,
          profile,
          authError: null,
        });

        if (!_authListenerRegistered) {
          _authListenerRegistered = true;
          supabase.auth.onAuthStateChange(async (_event, nextSession) => {
            if (!nextSession?.user) {
              set({ authStatus: "unauthenticated", user: null, profile: null });
              return;
            }
            try {
              const nextProfile = await fetchProfile(supabase, nextSession.user.id);
              if (!nextProfile?.is_active) {
                await supabase.auth.signOut();
                set({
                  authStatus: "unauthenticated",
                  user: null,
                  profile: null,
                  authError: "auth.accountDisabled",
                });
                return;
              }
              set({ authStatus: "authenticated", user: nextSession.user, profile: nextProfile });
            } catch {
              set({ authStatus: "unauthenticated", user: null, profile: null });
            }
          });
        }

        return { ok: true };
      } catch (err) {
        set({
          authStatus: "unauthenticated",
          user: null,
          profile: null,
          authError: err?.message || "auth.unknownError",
        });
        return { ok: false, reason: "error" };
      }
    },

    signIn: async (email, password) => {
      const supabase = getSupabase();
      if (!supabase) return { ok: false, error: "auth.notConfigured" };

      set({ authError: null });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        const code = error.message?.toLowerCase().includes("invalid")
          ? "auth.invalidCredentials"
          : error.message;
        set({ authError: code });
        return { ok: false, error: code };
      }

      const profile = await fetchProfile(supabase, data.user.id);
      if (!profile?.is_active) {
        await supabase.auth.signOut();
        set({ authError: "auth.accountDisabled" });
        return { ok: false, error: "auth.accountDisabled" };
      }

      set({
        authStatus: "authenticated",
        user: data.user,
        profile,
        authError: null,
      });
      return { ok: true };
    },

    signOut: async () => {
      const supabase = getSupabase();
      if (supabase) await supabase.auth.signOut();
      set({
        authStatus: "unauthenticated",
        user: null,
        profile: null,
        authError: null,
      });
      return { ok: true };
    },

    refreshProfile: async () => {
      const supabase = getSupabase();
      const { user } = get();
      if (!supabase || !user) return null;
      const profile = await fetchProfile(supabase, user.id);
      if (profile) set({ profile });
      return profile;
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
