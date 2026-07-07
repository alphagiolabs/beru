import { swallow } from "../../utils/swallow.js";
import bundledPetCatalog from "../../data/pets-catalog.json";

const FEATURED_SLUGS = ["boba", "doraemon", "wangcai", "eve", "mallow", "noir-webling"];
const DEFAULT_PET_MANIFEST = bundledPetCatalog;

async function persistPetSettings(partial) {
  const api = window.api;
  if (!api?.saveSettings) return;
  try {
    await api.saveSettings(partial);
  } catch (e) {
    swallow("saveSettings(pet)", e);
  }
}

/** Pet gallery, install flow, and floating companion state. */
export function createPetSlice(set, get) {
  return {
    petEnabled: false,
    petActiveSlug: null,
    petPosition: null,
    petSpritesheet: null,
    petManifest: DEFAULT_PET_MANIFEST,
    petManifestError: null,
    petManifestLoading: false,
    petInstalled: [],
    petInstalledLoading: false,
    petInstallingSlug: null,
    petUninstallingSlug: null,

    hydratePetSettings: (settings) => {
      set({
        petEnabled: settings?.petEnabled === true,
        petActiveSlug:
          typeof settings?.petActiveSlug === "string" && settings.petActiveSlug
            ? settings.petActiveSlug
            : null,
        petPosition:
          settings?.petPosition &&
          Number.isFinite(settings.petPosition.x) &&
          Number.isFinite(settings.petPosition.y)
            ? {
                x: Math.max(0, Math.floor(settings.petPosition.x)),
                y: Math.max(0, Math.floor(settings.petPosition.y)),
              }
            : null,
      });
    },

    setPetEnabled: async (enabled) => {
      const next = !!enabled;
      set({ petEnabled: next });
      await persistPetSettings({ petEnabled: next });
      if (next) {
        const { petActiveSlug } = get();
        if (petActiveSlug) get().loadPetSpritesheet(petActiveSlug);
      } else {
        set({ petSpritesheet: null });
      }
    },

    setPetPosition: async (position) => {
      const next =
        position && Number.isFinite(position.x) && Number.isFinite(position.y)
          ? {
              x: Math.max(0, Math.floor(position.x)),
              y: Math.max(0, Math.floor(position.y)),
            }
          : null;
      set({ petPosition: next });
      await persistPetSettings({ petPosition: next });
    },

    selectPet: async (slug) => {
      const safeSlug = String(slug || "").trim();
      if (!safeSlug) return { ok: false, error: "invalid-slug" };

      const installed = get().petInstalled.some((pet) => pet.slug === safeSlug);
      if (!installed) return { ok: false, error: "not-installed" };

      set({ petActiveSlug: safeSlug, petEnabled: true });
      await persistPetSettings({ petActiveSlug: safeSlug, petEnabled: true });
      const loaded = await get().loadPetSpritesheet(safeSlug);
      if (!loaded.ok) return loaded;
      return { ok: true };
    },

    loadPetSpritesheet: async (slug) => {
      const api = window.api;
      if (!api?.getPetSpritesheet) return { ok: false, error: "api-missing" };
      const safeSlug = String(slug || "").trim();
      if (!safeSlug) return { ok: false, error: "invalid-slug" };
      try {
        const res = await api.getPetSpritesheet(safeSlug);
        if (!res?.success || !res.dataUrl) return { ok: false, error: res?.error || "load-failed" };
        set({ petSpritesheet: res.dataUrl });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },

    loadInstalledPets: async () => {
      const api = window.api;
      if (!api?.listInstalledPets) return { ok: false, error: "api-missing" };
      set({ petInstalledLoading: true });
      try {
        const res = await api.listInstalledPets();
        if (!res?.success) {
          set({ petInstalledLoading: false });
          return { ok: false, error: res?.error };
        }
        const pets = res.pets || [];
        set({ petInstalled: pets, petInstalledLoading: false });

        const { petActiveSlug } = get();
        if (petActiveSlug && !pets.some((pet) => pet.slug === petActiveSlug)) {
          set({ petActiveSlug: null, petEnabled: false, petSpritesheet: null });
          await persistPetSettings({ petActiveSlug: null, petEnabled: false });
        }

        return { ok: true };
      } catch (e) {
        set({ petInstalledLoading: false });
        return { ok: false, error: e?.message || String(e) };
      }
    },

    fetchPetManifest: async ({ background = false } = {}) => {
      const api = window.api;
      if (!api?.fetchPetManifest) {
        set({
          petManifest: get().petManifest || DEFAULT_PET_MANIFEST,
          petManifestError: null,
        });
        return { ok: true };
      }

      if (!background || !get().petManifest?.pets?.length) {
        set({ petManifestLoading: true, petManifestError: null });
      }

      try {
        const res = await api.fetchPetManifest();
        if (!res?.success || !res.manifest?.pets?.length) {
          set({
            petManifest: get().petManifest || DEFAULT_PET_MANIFEST,
            petManifestLoading: false,
            petManifestError: res?.error || "fetch-failed",
          });
          return { ok: false, error: res?.error || "fetch-failed" };
        }

        set({
          petManifest: res.manifest,
          petManifestLoading: false,
          petManifestError: null,
        });
        return { ok: true };
      } catch (e) {
        const error = e?.message || String(e);
        set({
          petManifest: get().petManifest || DEFAULT_PET_MANIFEST,
          petManifestLoading: false,
          petManifestError: error,
        });
        return { ok: false, error };
      }
    },

    installPetEntry: async (entry) => {
      const api = window.api;
      if (!api?.installPet || !entry?.slug) return { ok: false, error: "invalid-entry" };
      set({ petInstallingSlug: entry.slug });
      try {
        const res = await api.installPet(entry);
        set({ petInstallingSlug: null });
        if (!res?.success) return { ok: false, error: res?.error };
        await get().loadInstalledPets();
        const selected = await get().selectPet(entry.slug);
        if (!selected.ok) return selected;
        return { ok: true, pet: res.pet };
      } catch (e) {
        set({ petInstallingSlug: null });
        return { ok: false, error: e?.message || String(e) };
      }
    },

    uninstallPetEntry: async (slug) => {
      const api = window.api;
      if (!api?.uninstallPet || !slug) return { ok: false, error: "invalid-slug" };
      set({ petUninstallingSlug: slug });
      try {
        const res = await api.uninstallPet(slug);
        set({ petUninstallingSlug: null });
        if (!res?.success) return { ok: false, error: res?.error };
        const { petActiveSlug } = get();
        if (petActiveSlug === slug) {
          set({ petActiveSlug: null, petEnabled: false, petSpritesheet: null });
          await persistPetSettings({ petActiveSlug: null, petEnabled: false });
        }
        await get().loadInstalledPets();
        return { ok: true };
      } catch (e) {
        set({ petUninstallingSlug: null });
        return { ok: false, error: e?.message || String(e) };
      }
    },

    getFeaturedPets: () => {
      const manifest = get().petManifest;
      if (!manifest?.pets) return [];
      const bySlug = new Map(manifest.pets.map((pet) => [pet.slug, pet]));
      return FEATURED_SLUGS.map((slug) => bySlug.get(slug)).filter(Boolean);
    },
  };
}
