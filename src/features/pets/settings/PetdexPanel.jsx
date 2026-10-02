import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import useEditorStore from "../../../stores/useEditorStore";
import { PET_SCALE_MAX, PET_SCALE_MIN } from "../../../stores/slices/petSlice";
import { useT } from "../../../i18n/useT";
import PetPreviewSprite from "../components/PetPreviewSprite.jsx";
import { petStates } from "../utils/pet-states.js";
import { PET_MOVEMENT_MODES } from "../../../utils/types.js";
import { storeErrorText } from "../../../utils/store-errors.js";
import { Select } from "../../../components/ui/select";

const PAGE_SIZE = 36;
const CATEGORIES = [
  { value: "all", labelKey: "settings.petdex.categoryAll" },
  { value: "Character", labelKey: "settings.petdex.categoryCharacter" },
  { value: "Creature", labelKey: "settings.petdex.categoryCreature" },
  { value: "Object", labelKey: "settings.petdex.categoryObject" },
];

function PetCard({ pet, isInstalled, isActive, isProcessing, onSelect }) {
  return (
    <article
      className={`settings-petdex-card-item${isActive ? " settings-petdex-card-item--active" : ""}${
        isProcessing ? " settings-petdex-card-item--busy" : ""
      }`}
      onClick={() => {
        if (!isProcessing && !isActive) onSelect(pet);
      }}
    >
      <div className="settings-petdex-card-preview">
        {isProcessing && !isActive ? (
          <div className="settings-petdex-card-loading">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : null}
        <PetPreviewSprite
          slug={pet.slug}
          remoteSrc={pet.spritesheetUrl}
          installed={isInstalled}
          label={pet.displayName}
          scale={0.5}
        />
        {isActive ? (
          <div className="settings-petdex-card-check">
            <Check size={12} strokeWidth={4} />
          </div>
        ) : null}
      </div>
      <div className="settings-petdex-card-meta">
        <span className="settings-petdex-card-name">{pet.displayName}</span>
        <span className="settings-petdex-card-author">{pet.submittedBy || pet.slug}</span>
      </div>
      <div className="settings-petdex-card-footer">
        <span className="settings-petdex-card-kind">{(pet.kind || "CREATURE").toUpperCase()}</span>
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
  const petOpacity = useEditorStore((s) => s.petOpacity);
  const petMovement = useEditorStore((s) => s.petMovement);
  const petManifest = useEditorStore((s) => s.petManifest);
  const petManifestLoading = useEditorStore((s) => s.petManifestLoading);
  const petInstalled = useEditorStore((s) => s.petInstalled);
  const petInstalledLoading = useEditorStore((s) => s.petInstalledLoading);
  const petInstallingSlug = useEditorStore((s) => s.petInstallingSlug);
  const syncPets = useEditorStore((s) => s.syncPets);
  const installPetEntry = useEditorStore((s) => s.installPetEntry);
  const selectPet = useEditorStore((s) => s.selectPet);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const setPetScale = useEditorStore((s) => s.setPetScale);
  const setPetOpacity = useEditorStore((s) => s.setPetOpacity);
  const setPetMovement = useEditorStore((s) => s.setPetMovement);
  const getGalleryPets = useEditorStore((s) => s.getGalleryPets);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  const galleryLoading = petManifestLoading || petInstalledLoading;

  const galleryPets = useMemo(
    () => getGalleryPets(),
    [getGalleryPets, petManifest, petInstalled, petManifestLoading],
  );
  const galleryTotal = galleryPets.length;

  const installedSlugs = useMemo(
    () => new Set(petInstalled.map((pet) => pet.slug)),
    [petInstalled],
  );

  const filteredPets = useMemo(() => {
    let list = galleryPets;
    if (category !== "all") {
      list = list.filter((p) => p.kind?.toLowerCase() === category.toLowerCase());
    }
    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (pet) =>
          pet.displayName?.toLowerCase().includes(needle) ||
          pet.slug?.toLowerCase().includes(needle) ||
          pet.submittedBy?.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [galleryPets, query, category]);

  const totalPages = Math.max(1, Math.ceil(filteredPets.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage !== safePage) setCurrentPage(safePage);
  }, [currentPage, safePage]);

  const startIndex = (safePage - 1) * PAGE_SIZE;
  const visiblePets = filteredPets.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    void syncPets({ background: true });
  }, [syncPets]);

  const handleRefreshGallery = useCallback(() => {
    void syncPets({ background: false });
  }, [syncPets]);

  const handleSelectPet = useCallback(
    async (pet) => {
      if (petInstallingSlug) return;

      if (!installedSlugs.has(pet.slug)) {
        const res = await installPetEntry(pet);
        if (!res.ok) {
          showToast({
            kind: "err",
            text: storeErrorText(t, res, "settings.petdex.installFailed"),
          });
        }
        return;
      }

      const res = await selectPet(pet.slug);
      if (!res.ok) {
        showToast({
          kind: "err",
          text: storeErrorText(t, res, "settings.petdex.selectFailed"),
        });
      }
    },
    [installedSlugs, installPetEntry, selectPet, petInstallingSlug, showToast, t],
  );

  const activePetObj = galleryPets.find((p) => p.slug === petActiveSlug);
  const activePetName = activePetObj?.displayName || "";

  return (
    <div className="settings-petdex-new">
      <div className="settings-petdex-header">
        <div className="settings-petdex-header-left">
          <label className="settings-petdex-toggle-label">
            <span className="settings-petdex-label-text">{t("settings.petdex.enabled")}</span>
            <button
              type="button"
              className={`settings-petdex-switch ${petEnabled ? "is-active" : ""}`}
              onClick={() => setPetEnabled(!petEnabled)}
              disabled={!petActiveSlug}
              role="switch"
              aria-checked={petEnabled}
              aria-label={t("settings.petdex.enabled")}
            >
              <div className="settings-petdex-switch-thumb" />
            </button>
          </label>

          <div className="settings-petdex-slider-group">
            <span className="settings-petdex-label-text">{t("settings.petdex.scale")}</span>
            <input
              type="range"
              aria-label={t("settings.petdex.scale")}
              min={PET_SCALE_MIN}
              max={PET_SCALE_MAX}
              step={0.05}
              value={petScale}
              onChange={(e) => setPetScale(Number(e.target.value))}
              className="settings-petdex-slider"
            />
            <span className="settings-petdex-val-text">{petScale.toFixed(2)}x</span>
          </div>

          <div className="settings-petdex-slider-group">
            <span className="settings-petdex-label-text">{t("settings.petdex.opacity")}</span>
            <input
              type="range"
              aria-label={t("settings.petdex.opacity")}
              min={0.1}
              max={1.0}
              step={0.05}
              value={petOpacity}
              onChange={(e) => setPetOpacity(Number(e.target.value))}
              className="settings-petdex-slider"
            />
            <span className="settings-petdex-val-text">{Math.round(petOpacity * 100)}%</span>
          </div>
        </div>

        <div className="settings-petdex-header-right">
          <div className="settings-petdex-mov-group">
            <span className="settings-petdex-label-text">{t("settings.petdex.movement")}</span>
            <Select
              size="sm"
              value={petMovement}
              onValueChange={setPetMovement}
              aria-label={t("settings.petdex.movement")}
              options={[
                ...PET_MOVEMENT_MODES.map((m) => ({ value: m.id, label: t(m.labelKey) })),
                ...petStates
                  .filter(
                    (s) => !["idle", "running-left", "running-right", "running"].includes(s.id),
                  )
                  .map((s) => ({ value: s.id, label: t(s.labelKey) })),
              ]}
            />
          </div>

          <div className="settings-petdex-sync-badge">
            <Check size={14} className="sync-icon" /> {t("settings.petdex.synced")}
          </div>
        </div>
      </div>

      <div className="settings-petdex-tools">
        <label className="settings-petdex-searchbox">
          <Search size={16} />
          <input
            type="text"
            placeholder={t("settings.petdex.searchGallery")}
            aria-label={t("settings.petdex.searchGallery")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
        </label>

        <div className="settings-petdex-filters">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              className={`settings-petdex-filter-btn ${category === cat.value ? "is-active" : ""}`}
              aria-pressed={category === cat.value}
              onClick={() => {
                setCategory(cat.value);
                setCurrentPage(1);
              }}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </div>

        <div className="settings-petdex-tools-right">
          <button
            className="settings-petdex-refresh-btn"
            onClick={handleRefreshGallery}
            disabled={galleryLoading}
            title={t("settings.petdex.retryGallery")}
            aria-label={t("settings.petdex.retryGallery")}
          >
            <RefreshCw size={14} className={galleryLoading ? "animate-spin" : ""} />
          </button>
          <span className="settings-petdex-total-text">
            {filteredPets.length}/{galleryTotal}
          </span>
        </div>
      </div>

      <div className="settings-petdex-body">
        {galleryLoading && galleryPets.length === 0 ? (
          <div className="settings-petdex-loading">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : visiblePets.length === 0 ? (
          <div className="settings-petdex-empty">{t("settings.petdex.noResults")}</div>
        ) : (
          <div className="settings-petdex-grid-new">
            {visiblePets.map((pet) => (
              <PetCard
                key={pet.slug}
                pet={pet}
                isInstalled={installedSlugs.has(pet.slug)}
                isActive={petActiveSlug === pet.slug}
                isProcessing={petInstallingSlug === pet.slug}
                onSelect={handleSelectPet}
              />
            ))}
          </div>
        )}
      </div>

      <div className="settings-petdex-footer">
        <div className="settings-petdex-footer-left">
          {activePetObj && (
            <div className="settings-petdex-footer-active-preview">
              <PetPreviewSprite
                slug={activePetObj.slug}
                remoteSrc={activePetObj.spritesheetUrl}
                installed={installedSlugs.has(activePetObj.slug)}
                label={activePetName}
                scale={0.11}
              />
            </div>
          )}
          {activePetName && <span className="settings-petdex-footer-name">{activePetName}</span>}
          <span className="settings-petdex-footer-range">
            {activePetName && " - "}
            {filteredPets.length > 0 ? startIndex + 1 : 0}-
            {Math.min(startIndex + PAGE_SIZE, filteredPets.length)} de {filteredPets.length}
          </span>
        </div>
        <div className="settings-petdex-pagination">
          <button
            className="settings-petdex-page-btn"
            disabled={safePage <= 1}
            aria-label={t("settings.petdex.previousPage")}
            onClick={() => setCurrentPage(safePage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="settings-petdex-page-text">
            {safePage}/{totalPages}
          </span>
          <button
            className="settings-petdex-page-btn"
            disabled={safePage >= totalPages}
            aria-label={t("settings.petdex.nextPage")}
            onClick={() => setCurrentPage(safePage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
