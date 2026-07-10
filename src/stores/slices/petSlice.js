import { swallow } from "../../utils/swallow.js";
import { beruLocalUrl } from "../../features/pets/utils/pet-url.js";

const FEATURED_SLUGS = ["boba", "doraemon", "wangcai", "eve", "mallow", "noir-webling"];
const EMPTY_MANIFEST = { total: 0, pets: [] };
export const PET_SCALE_MIN = 0.1;
export const PET_SCALE_MAX = 3;
export const PET_SCALE_DEFAULT = 0.33;

/** In-flight promise so concurrent ensurePetsReady callers share one init. */
let petsInitPromise = null;

function clampPetScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return PET_SCALE_DEFAULT;
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, Math.round(n * 100) / 100));
}

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
    petPopoutPosition: null,
    petPoppedOut: false,
    petScale: PET_SCALE_DEFAULT,
    petOpacity: 1.0,
    petMovement: "fijo",
    petSpritesheet: null,
    petSpritesheetLoading: false,
    petManifest: EMPTY_MANIFEST,
    petManifestError: null,
    petManifestLoading: false,
    petInstalled: [],
    petInstalledLoading: false,
    petInstallingSlug: null,
    petUninstallingSlug: null,
    showPetPalette: false,
    petsInitialized: false,

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
        petPopoutPosition:
          settings?.petPopoutPosition &&
          Number.isFinite(settings.petPopoutPosition.x) &&
          Number.isFinite(settings.petPopoutPosition.y)
            ? {
                x: Math.max(0, Math.floor(settings.petPopoutPosition.x)),
                y: Math.max(0, Math.floor(settings.petPopoutPosition.y)),
              }
            : null,
        petPoppedOut: settings?.petPoppedOut === true,
        petScale: clampPetScale(settings?.petScale ?? PET_SCALE_DEFAULT),
        petOpacity:
          typeof settings?.petOpacity === "number"
            ? Math.min(1, Math.max(0.1, settings.petOpacity))
            : 1.0,
        petMovement: typeof settings?.petMovement === "string" ? settings.petMovement : "fijo",
      });
    },

    setPetEnabled: async (enabled) => {
      const next = !!enabled;
      set({ petEnabled: next });
      await persistPetSettings({ petEnabled: next });
      if (next) {
        const { petActiveSlug } = get();
        if (petActiveSlug) await get().loadPetSpritesheet(petActiveSlug);
        if (get().petPoppedOut) await get().syncPetOverlay("idle");
      } else {
        set({ petSpritesheet: null, petSpritesheetLoading: false });
        if (get().petPoppedOut) {
          try {
            await window.api?.closePetOverlay?.();
          } catch (e) {
            swallow("closePetOverlay", e);
          }
          await get().setPetPoppedOut(false);
        }
      }
    },

    setPetScale: async (scale) => {
      const next = clampPetScale(scale);
      set({ petScale: next });
      await persistPetSettings({ petScale: next });
      if (get().petPoppedOut) {
        await get().syncPetOverlay("idle");
      }
    },

    setPetOpacity: async (opacity) => {
      const next = typeof opacity === "number" ? Math.min(1, Math.max(0.1, opacity)) : 1.0;
      set({ petOpacity: next });
      await persistPetSettings({ petOpacity: next });
      if (get().petPoppedOut) {
        await get().syncPetOverlay("idle");
      }
    },

    setPetMovement: async (movement) => {
      const next = movement === "caminar" ? "caminar" : "fijo";
      set({ petMovement: next });
      await persistPetSettings({ petMovement: next });
      if (get().petPoppedOut) {
        await get().syncPetOverlay("idle");
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

    setPetPopoutPosition: async (position) => {
      const next =
        position && Number.isFinite(position.x) && Number.isFinite(position.y)
          ? {
              x: Math.max(0, Math.floor(position.x)),
              y: Math.max(0, Math.floor(position.y)),
            }
          : null;
      set({ petPopoutPosition: next });
      await persistPetSettings({ petPopoutPosition: next });
    },

    setPetPoppedOut: async (poppedOut) => {
      const next = !!poppedOut;
      set({ petPoppedOut: next });
      await persistPetSettings({ petPoppedOut: next });
    },

    togglePetPopout: async () => {
      const api = window.api;
      const { petPoppedOut, petPopoutPosition, petPosition } = get();
      const next = !petPoppedOut;
      const anchor = petPopoutPosition || petPosition || null;

      if (api?.togglePetOverlay) {
        try {
          await api.togglePetOverlay(anchor);
        } catch (e) {
          swallow("togglePetOverlay", e);
          return { ok: false, error: e?.message || String(e) };
        }
      } else if (next && api?.openPetOverlay) {
        try {
          await api.openPetOverlay(anchor);
        } catch (e) {
          swallow("openPetOverlay", e);
          return { ok: false, error: e?.message || String(e) };
        }
      } else if (!next && api?.closePetOverlay) {
        try {
          await api.closePetOverlay();
        } catch (e) {
          swallow("closePetOverlay", e);
        }
      }

      await get().setPetPoppedOut(next);
      if (next) {
        await get().syncPetOverlay("idle");
      }
      return { ok: true, poppedOut: next };
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

      if (get().petSpritesheetLoading) return { ok: false, error: "already-loading" };

      set({ petSpritesheetLoading: true });
      try {
        const res = await api.getPetSpritesheet(safeSlug);
        if (!res?.success || !res.path) {
          set({ petSpritesheet: null, petSpritesheetLoading: false });
          return { ok: false, error: res?.error || "load-failed" };
        }
        set({ petSpritesheet: beruLocalUrl(res.path), petSpritesheetLoading: false });
        if (get().petPoppedOut) {
          await get().syncPetOverlay("idle");
        }
        return { ok: true };
      } catch (e) {
        set({ petSpritesheet: null, petSpritesheetLoading: false });
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
        set({ petManifest: EMPTY_MANIFEST, petManifestError: null });
        return { ok: true };
      }

      if (!background || !get().petManifest?.pets?.length) {
        set({ petManifestLoading: true, petManifestError: null });
      }

      try {
        const res = await api.fetchPetManifest();
        if (!res?.success || !res.manifest?.pets?.length) {
          const fallback = get().petManifest?.pets?.length ? get().petManifest : EMPTY_MANIFEST;
          const hasFallback = fallback.pets.length > 0;
          set({
            petManifest: fallback,
            petManifestError: hasFallback ? null : res?.error || "fetch-failed",
            petManifestLoading: false,
          });
          return { ok: hasFallback, error: hasFallback ? null : res?.error || "fetch-failed" };
        }

        set({
          petManifest: res.manifest,
          petManifestError: null,
          petManifestLoading: false,
        });
        return { ok: true };
      } catch (e) {
        const fallback = get().petManifest?.pets?.length ? get().petManifest : EMPTY_MANIFEST;
        const hasFallback = fallback.pets.length > 0;
        const error = e?.message || String(e);
        set({
          petManifest: fallback,
          petManifestError: hasFallback ? null : error,
          petManifestLoading: false,
        });
        return { ok: hasFallback, error: hasFallback ? null : error };
      }
    },

    syncPets: async ({ background = false } = {}) => {
      const [manifestRes, installedRes] = await Promise.all([
        get().fetchPetManifest({ background }),
        get().loadInstalledPets(),
      ]);
      return {
        ok: manifestRes.ok && installedRes.ok,
        manifest: manifestRes,
        installed: installedRes,
      };
    },

    initPets: async () => {
      await get().syncPets({ background: true });
      const { petEnabled, petActiveSlug, petPoppedOut, petPopoutPosition, petPosition } = get();
      if (petEnabled && petActiveSlug) {
        await get().loadPetSpritesheet(petActiveSlug);
      }
      if (petEnabled && petPoppedOut && petActiveSlug && window.api?.openPetOverlay) {
        try {
          await window.api.openPetOverlay(petPopoutPosition || petPosition);
        } catch (e) {
          swallow("openPetOverlay(init)", e);
        }
      }
      set({ petsInitialized: true });
    },

    ensurePetsReady: () => {
      if (get().petsInitialized) return Promise.resolve();
      if (!petsInitPromise) {
        petsInitPromise = get()
          .initPets()
          .finally(() => {
            petsInitPromise = null;
          });
      }
      return petsInitPromise;
    },

    setShowPetPalette: (val) => set({ showPetPalette: !!val }),

    buildPetOverlayPayload: (petState) => {
      const {
        petEnabled,
        petActiveSlug,
        petSpritesheet,
        petScale,
        petOpacity,
        petMovement,
        language,
      } = get();
      return {
        enabled: petEnabled,
        slug: petActiveSlug,
        spritesheet: petSpritesheet,
        scale: petScale,
        opacity: petOpacity,
        movement: petMovement,
        state: petState || "idle",
        language: language || "es",
      };
    },

    syncPetOverlay: async (petState) => {
      const api = window.api;
      if (!api?.syncPetOverlayState) return;
      try {
        await api.syncPetOverlayState(get().buildPetOverlayPayload(petState));
      } catch (e) {
        swallow("syncPetOverlayState", e);
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

      const installed = get().petInstalled.find((pet) => pet.slug === slug);
      if (installed?.source === "codex") {
        return { ok: false, error: "codex-pet" };
      }

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

    getGalleryPets: () => {
      const manifestPets = get().petManifest?.pets || [];
      const installed = get().petInstalled;
      const featured = new Set(FEATURED_SLUGS);
      const bySlug = new Map(manifestPets.map((pet) => [pet.slug, pet]));

      for (const pet of installed) {
        if (!bySlug.has(pet.slug)) {
          bySlug.set(pet.slug, {
            slug: pet.slug,
            displayName: pet.displayName,
            spritesheetUrl: pet.spritesheetUrl || "",
            kind: pet.kind || "creature",
            submittedBy: pet.submittedBy || "",
            source: pet.source,
          });
        }
      }

      return [...bySlug.values()].sort((a, b) => {
        const aInstalled = installed.some((pet) => pet.slug === a.slug) ? 0 : 1;
        const bInstalled = installed.some((pet) => pet.slug === b.slug) ? 0 : 1;
        if (aInstalled !== bInstalled) return aInstalled - bInstalled;
        const aFeatured = featured.has(a.slug) ? 0 : 1;
        const bFeatured = featured.has(b.slug) ? 0 : 1;
        if (aFeatured !== bFeatured) return aFeatured - bFeatured;
        return (a.displayName || a.slug).localeCompare(b.displayName || b.slug);
      });
    },
  };
}
