import { supabase, getSupabaseConfig } from "../../lib/supabaseClient.js";

export function createAuthSlice(set, get) {
  return {
    session: null,
    user: null,
    isAdmin: false,
    authReady: false,
    authError: null,
    _authSubscription: null,

    initAuth: async () => {
      if (!supabase) {
        set({ authReady: true, authError: "supabase-not-configured" });
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session || null;
        if (session) {
          const user = session.user;
          const role = await get().fetchUserRole(user.id);
          set({
            session,
            user,
            isAdmin: role === "admin",
            authReady: true,
            authError: null,
          });
        } else {
          set({ session: null, user: null, isAdmin: false, authReady: true, authError: null });
        }
      } catch (e) {
        set({ authReady: true, authError: e.message });
      }

      if (supabase && !get()._authSubscription) {
        const { data: subData } = supabase.auth.onAuthStateChange((_event, newSession) => {
          if (!newSession) {
            set({ session: null, user: null, isAdmin: false });
          } else {
            get().fetchUserRole(newSession.user.id).then((role) => {
              set({
                session: newSession,
                user: newSession.user,
                isAdmin: role === "admin",
              });
            });
          }
        });
        set({ _authSubscription: subData?.subscription });
      }
    },

    fetchUserRole: async (userId) => {
      if (!supabase || !userId) return "user";
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .single();
        return data?.role || "user";
      } catch {
        return "user";
      }
    },

    signIn: async (email, password) => {
      if (!supabase) {
        const cfg = getSupabaseConfig();
        if (!cfg.isConfigured) {
          return { ok: false, error: "Supabase no está configurado. Contacta al administrador." };
        }
        return { ok: false, error: "Cliente no disponible." };
      }
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, error: error.message };
        const session = data?.session;
        if (!session) return { ok: false, error: "No se pudo iniciar sesión." };
        const role = await get().fetchUserRole(session.user.id);
        set({
          session,
          user: session.user,
          isAdmin: role === "admin",
          authError: null,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    signOut: async () => {
      if (supabase) {
        try {
          await supabase.auth.signOut();
        } catch {}
      }
      set({ session: null, user: null, isAdmin: false });
    },
  };
}
