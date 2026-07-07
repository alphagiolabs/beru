import { ExternalLink, Loader2, PawPrint, Power, Settings } from "lucide-react";
import useEditorStore from "../../stores/useEditorStore";
import { PET_SCALE_DEFAULT, PET_SCALE_MAX, PET_SCALE_MIN } from "../../stores/slices/petSlice";
import { useT } from "../../i18n/useT";
import usePetState from "../../hooks/usePetState";
import PetPreviewSprite from "../pets/PetPreviewSprite.jsx";
import PetSprite from "../pets/PetSprite.jsx";

const SCALE_PRESETS = [
  { id: "small", value: 0.2 },
  { id: "medium", value: PET_SCALE_DEFAULT },
  { id: "large", value: 1 },
];

export default function PetCompanionSection() {
  const t = useT();
  const petState = usePetState();
  const petEnabled = useEditorStore((s) => s.petEnabled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petScale = useEditorStore((s) => s.petScale);
  const petSpritesheet = useEditorStore((s) => s.petSpritesheet);
  const petSpritesheetLoading = useEditorStore((s) => s.petSpritesheetLoading);
  const petInstalled = useEditorStore((s) => s.petInstalled);
  const petPoppedOut = useEditorStore((s) => s.petPoppedOut);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const setPetScale = useEditorStore((s) => s.setPetScale);
  const togglePetPopout = useEditorStore((s) => s.togglePetPopout);
  const setShowPetPalette = useEditorStore((s) => s.setShowPetPalette);
  const openSettingsTab = useEditorStore((s) => s.openSettingsTab);

  const activePet = petInstalled.find((pet) => pet.slug === petActiveSlug);
  const previewScale = Math.min(0.42, petScale);

  return (
    <section className="settings-card settings-appearance-pet-card">
      <header className="settings-card-head">
        <div className="settings-card-head-left">
          <PawPrint size={14} strokeWidth={2.25} />
          <span>{t("settings.petdex.companion")}</span>
        </div>
        <button
          type="button"
          className={`settings-petdex-toggle${petEnabled ? " settings-petdex-toggle--on" : ""}`}
          onClick={() => setPetEnabled(!petEnabled)}
          disabled={!petActiveSlug}
          title={t("settings.petdex.togglePet")}
        >
          <Power size={12} />
          {petEnabled ? t("settings.petdex.petOn") : t("settings.petdex.petOff")}
        </button>
      </header>

      <div className="settings-appearance-pet-body">
        <div className="settings-appearance-pet-preview-group">
          <div className="settings-petdex-live-preview settings-appearance-pet-preview">
            {petSpritesheetLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : petSpritesheet && petActiveSlug ? (
              <PetSprite src={petSpritesheet} state={petState} scale={previewScale} />
            ) : (
              <span className="settings-petdex-live-preview-empty">
                {t("settings.petdex.previewEmpty")}
              </span>
            )}
          </div>
          {activePet ? (
            <div className="settings-appearance-pet-thumb">
              <PetPreviewSprite
                slug={activePet.slug}
                remoteSrc={activePet.spritesheetUrl}
                installed
                scale={0.28}
                label={activePet.displayName}
              />
              <span className="settings-appearance-pet-source">
                {activePet.source === "codex"
                  ? t("settings.petdex.badgeCodex")
                  : t("settings.petdex.badgeBeru")}
              </span>
            </div>
          ) : null}
        </div>

        <div className="settings-appearance-pet-copy">
          <p className="settings-petdex-description">{t("settings.petdex.appearanceHint")}</p>
          <div className="settings-petdex-active-meta">
            <span className="settings-petdex-active-label">{t("settings.petdex.currentPet")}</span>
            <span className="settings-petdex-active-value">
              {activePet?.displayName || petActiveSlug || t("settings.petdex.noneSelected")}
            </span>
          </div>

          <div className="settings-petdex-size-control">
            <span className="settings-petdex-active-label">{t("settings.petdex.size")}</span>
            <div className="settings-petdex-size-presets">
              {SCALE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`cap-btn-secondary settings-petdex-size-preset${Math.abs(petScale - preset.value) < 0.01 ? " settings-petdex-size-preset--active" : ""}`}
                  onClick={() => setPetScale(preset.value)}
                >
                  {t(`settings.petdex.size${preset.id[0].toUpperCase()}${preset.id.slice(1)}`)}
                </button>
              ))}
            </div>
            <input
              type="range"
              className="settings-petdex-size-slider"
              min={PET_SCALE_MIN}
              max={PET_SCALE_MAX}
              step={0.05}
              value={petScale}
              onChange={(event) => setPetScale(Number(event.target.value))}
              aria-label={t("settings.petdex.size")}
            />
          </div>

          <div className="settings-appearance-pet-actions">
            <button
              type="button"
              className="cap-btn-secondary"
              onClick={() => setShowPetPalette(true)}
            >
              {t("settings.petdex.paletteOpen")}
            </button>
            {petActiveSlug ? (
              <button
                type="button"
                className="cap-btn-secondary"
                disabled={!petEnabled}
                onClick={() => togglePetPopout()}
              >
                <ExternalLink size={12} />
                {petPoppedOut ? t("settings.petdex.popIn") : t("settings.petdex.popOut")}
              </button>
            ) : null}
            <button
              type="button"
              className="cap-btn-secondary"
              onClick={() => openSettingsTab("pets")}
            >
              <Settings size={12} />
              {t("settings.petdex.paletteBrowse")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
