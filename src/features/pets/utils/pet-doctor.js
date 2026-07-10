/**
 * Hermes-style pet setup diagnostics for Beru.
 *
 * @param {{
 *   petEnabled?: boolean,
 *   petActiveSlug?: string | null,
 *   petInstalled?: Array<{ slug: string, source?: string }>,
 *   petSpritesheet?: string | null,
 *   petManifestError?: string | null,
 * }} state
 */
export function diagnosePetSetup(state) {
  const checks = [];
  const issues = [];

  const installed = state.petInstalled || [];
  const activeSlug = state.petActiveSlug || null;

  checks.push({
    id: "installed",
    ok: installed.length > 0,
    detail: installed.length > 0 ? `${installed.length}` : "0",
  });
  if (installed.length === 0) issues.push("no-installed");

  checks.push({
    id: "selected",
    ok: !!activeSlug,
    detail: activeSlug || "",
  });
  if (!activeSlug) issues.push("no-selected");

  const activeInstalled = activeSlug ? installed.some((pet) => pet.slug === activeSlug) : false;
  if (activeSlug && !activeInstalled) issues.push("activeMissing");

  checks.push({
    id: "spritesheet",
    ok: !!state.petSpritesheet,
    detail: state.petSpritesheet ? "loaded" : "missing",
  });
  if (state.petEnabled && activeSlug && !state.petSpritesheet) {
    issues.push("spritesheet-missing");
  }

  checks.push({
    id: "enabled",
    ok: state.petEnabled === true,
    detail: state.petEnabled ? "on" : "off",
  });

  if (state.petManifestError) {
    checks.push({
      id: "gallery",
      ok: false,
      detail: state.petManifestError,
    });
    issues.push("gallery-offline");
  } else {
    checks.push({ id: "gallery", ok: true, detail: "ok" });
  }

  return {
    ready:
      issues.length === 0 && state.petEnabled === true && !!activeSlug && !!state.petSpritesheet,
    checks,
    issues,
  };
}
