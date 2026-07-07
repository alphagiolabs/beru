import { useCallback, useMemo, useState } from "react";
import {
  Check,
  Download,
  Loader2,
  PawPrint,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import useEditorStore from "../../stores/useEditorStore";
import { PET_SCALE_DEFAULT, PET_SCALE_MAX, PET_SCALE_MIN } from "../../stores/slices/petSlice";
import { useT } from "../../i18n/useT";
import PetPreviewSprite from "../pets/PetPreviewSprite.jsx";
import PetSprite from "../pets/PetSprite.jsx";

const PAGE_SIZE = 24;
const SCALE_PRESETS = [
  { id: "small", value: 0.35 },
  { id: "medium", value: PET_SCALE_DEFAULT },
  { id: "large", value: 0.75 },
];

function PetCard({
  pet,
  installed,
  active,
  installing,
  uninstalling,
  codexOnly,
  t,
  onInstall,
  onSelect,
  onUninstall,
}) {
  const isInstalled = installed.has(pet.slug);
  const isActive = active === pet.slug;

  return (
    <article
      className={`settings-petdex-card-item${isActive ? " settings-petdex-card-item--active" : ""}`}
    >
      <div className="settings-petdex-card-preview">
        <PetPreviewSprite
          slug={pet.slug}
          remoteSrc={pet.spritesheetUrl}
          installed={isInstalled}
          label={pet.displayName}
        />
      </div>
      <div className="settings-petdex-card-meta">
        <span className="settings-petdex-card-name">{pet.displayName}</span>
        <span className="settings-petdex-card-kind">
          {codexOnly ? t("settings.petdex.codexPet") : pet.kind || t("settings.petdex.kindPet")}
        </span>
      </div>
      <div className="settings-petdex-card-actions">
        {isInstalled ? (
          <>
            <button
              type="button"
              className={`cap-btn-secondary settings-petdex-select-btn${isActive ? " settings-petdex-select-btn--active" : ""}`}
              onClick={() => onSelect(pet.slug)}
            >
              {isActive ? <Check size={12} /> : null}
              {isActive ? t("settings.petdex.activePet") : t("settings.petdex.selectPet")}
            </button>
            {!codexOnly ? (
              <button
                type="button"
                className="settings-petdex-uninstall-btn"
                disabled={uninstalling === pet.slug}
                onClick={() => onUninstall(pet.slug)}
                title={t("settings.petdex.uninstallPet")}
              >
                {uninstalling === pet.slug ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className="cap-btn-primary settings-petdex-install-btn"
            disabled={installing === pet.slug}
            onClick={() => onInstall(pet)}
          >
            {installing === pet.slug ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            {t("settings.petdex.installPet")}
          </button>
        )}
      </div>
    </article>
  );
}

export default function PetdexPanel() {
  const t = useT();
  const showToast = useEditorStore((s) => s.showToast);
  const petEnabled = useEditorStore((s) => s.petEnabled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petScale = useEditorStore((s) => s.petScale);
  const petSpritesheet = useEditorStore((s) => s.petSpritesheet);
  const petSpritesheetLoading = useEditorStore((s) => s.petSpritesheetLoading);
  const petManifest = useEditorStore((s) => s.petManifest);
  const petManifestError = useEditorStore((s) => s.petManifestError);
  const petManifestLoading = useEditorStore((s) => s.petManifestLoading);
  const petInstalled = useEditorStore((s) => s.petInstalled);
  const petInstalledLoading = useEditorStore((s) => s.petInstalledLoading);
  const petInstallingSlug = useEditorStore((s) => s.petInstallingSlug);
  const petUninstallingSlug = useEditorStore((s) => s.petUninstallingSlug);
  const fetchPetManifest = useEditorStore((s) => s.fetchPetManifest);
  const installPetEntry = useEditorStore((s) => s.installPetEntry);
  const uninstallPetEntry = useEditorStore((s) => s.uninstallPetEntry);
  const selectPet = useEditorStore((s) => s.selectPet);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const setPetScale = useEditorStore((s) => s.setPetScale);
  const getGalleryPets = useEditorStore((s) => s.getGalleryPets);

  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const galleryLoading =
    (petManifestLoading && !(petManifest?.pets?.length > 0)) || petInstalledLoading;

  const galleryPets = useMemo(() => getGalleryPets(), [getGalleryPets, petManifest, petInstalled]);

  const installedSlugs = useMemo(
    () => new Set(petInstalled.map((pet) => pet.slug)),
    [petInstalled],
  );

  const codexOnlySlugs = useMemo(
    () => new Set(petInstalled.filter((pet) => pet.source === "codex").map((pet) => pet.slug)),
    [petInstalled],
  );

  const filteredPets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return galleryPets;
    return galleryPets.filter(
      (pet) =>
        pet.displayName?.toLowerCase().includes(needle) || pet.slug?.toLowerCase().includes(needle),
    );
  }, [galleryPets, query]);

  const visiblePets = filteredPets.slice(0, visibleCount);
  const previewScale = Math.min(0.5, petScale);

  const handleInstall = useCallback(
    async (entry) => {
      const res = await installPetEntry(entry);
      if (res.ok) {
        showToast({
          kind: "ok",
          text: t("settings.petdex.installedToast", { name: entry.displayName }),
        });
        return;
      }
      showToast({ kind: "err", text: res.error || t("settings.petdex.installFailed") });
    },
    [installPetEntry, showToast, t],
  );

  const handleSelect = useCallback(
    async (slug) => {
      const res = await selectPet(slug);
      if (res.ok) {
        showToast({ kind: "ok", text: t("settings.petdex.selected") });
        return;
      }
      showToast({ kind: "err", text: res.error || t("settings.petdex.selectFailed") });
    },
    [selectPet, showToast, t],
  );

  const handleUninstall = useCallback(
    async (slug) => {
      const res = await uninstallPetEntry(slug);
      if (res.ok) {
        showToast({ kind: "ok", text: t("settings.petdex.uninstalled") });
        return;
      }
      if (res.error === "codex-pet") {
        showToast({ kind: "err", text: t("settings.petdex.codexUninstallHint") });
        return;
      }
      showToast({ kind: "err", text: res.error || t("settings.petdex.uninstallFailed") });
    },
    [uninstallPetEntry, showToast, t],
  );

  return (
    <div className="settings-petdex">
      <section className="settings-card settings-petdex-active-card">
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

        <div className="settings-petdex-active-body">
          <div className="settings-petdex-active-layout">
            <div className="settings-petdex-live-preview">
              {petSpritesheetLoading ? (
                <div className="settings-petdex-loading">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : petSpritesheet && petActiveSlug ? (
                <PetSprite src={petSpritesheet} state="idle" scale={previewScale} />
              ) : (
                <div className="settings-petdex-live-preview-empty">
                  {t("settings.petdex.previewEmpty")}
                </div>
              )}
            </div>
            <div className="settings-petdex-active-copy">
              <p className="settings-petdex-description">{t("settings.petdex.description")}</p>
              <div className="settings-petdex-active-meta">
                <span className="settings-petdex-active-label">
                  {t("settings.petdex.currentPet")}
                </span>
                <span className="settings-petdex-active-value">
                  {petActiveSlug
                    ? petInstalled.find((pet) => pet.slug === petActiveSlug)?.displayName ||
                      petActiveSlug
                    : t("settings.petdex.noneSelected")}
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
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card settings-petdex-gallery-card">
        <header className="settings-card-head">
          <div className="settings-card-head-left">
            <Sparkles size={14} strokeWidth={2.25} />
            <span>{t("settings.petdex.gallery")}</span>
          </div>
          <div className="settings-petdex-gallery-head-tools">
            <span className="settings-users-count">{petManifest?.total || galleryPets.length}</span>
            <button
              type="button"
              className="settings-petdex-retry-btn"
              onClick={() => fetchPetManifest({ background: false })}
              disabled={petManifestLoading}
              title={t("settings.petdex.retryGallery")}
            >
              <RefreshCw size={12} className={petManifestLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        <div className="settings-petdex-gallery-tools">
          <label className="settings-petdex-search">
            <Search size={13} />
            <input
              type="search"
              className="cap-input"
              value={query}
              placeholder={t("settings.petdex.searchPlaceholder")}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
            />
          </label>
        </div>

        {petManifestError ? (
          <p className="settings-petdex-error" role="alert">
            {t("settings.petdex.galleryError")}
          </p>
        ) : null}

        <div className="settings-petdex-gallery-scroll">
          {galleryLoading ? (
            <div className="settings-petdex-loading">
              <Loader2 size={16} className="animate-spin" />
              <span>{t("settings.petdex.loading")}</span>
            </div>
          ) : visiblePets.length === 0 ? (
            <p className="settings-petdex-empty">{t("settings.petdex.noResults")}</p>
          ) : (
            <>
              <div className="settings-petdex-grid">
                {visiblePets.map((pet) => (
                  <PetCard
                    key={pet.slug}
                    pet={pet}
                    installed={installedSlugs}
                    active={petActiveSlug}
                    installing={petInstallingSlug}
                    uninstalling={petUninstallingSlug}
                    codexOnly={codexOnlySlugs.has(pet.slug)}
                    t={t}
                    onInstall={handleInstall}
                    onSelect={handleSelect}
                    onUninstall={handleUninstall}
                  />
                ))}
              </div>
              {visibleCount < filteredPets.length && (
                <div className="settings-petdex-more">
                  <button
                    type="button"
                    className="cap-btn-secondary"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  >
                    {t("settings.petdex.loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
