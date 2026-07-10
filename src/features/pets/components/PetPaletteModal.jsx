import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, PawPrint, Power, Search, Settings, X } from "lucide-react";
import useEditorStore from "../../../stores/useEditorStore";
import { useT } from "../../../i18n/useT";
import PetPreviewSprite from "./PetPreviewSprite.jsx";

export default function PetPaletteModal() {
  const t = useT();
  const showPetPalette = useEditorStore((s) => s.showPetPalette);
  const setShowPetPalette = useEditorStore((s) => s.setShowPetPalette);
  const openSettingsTab = useEditorStore((s) => s.openSettingsTab);
  const petInstalled = useEditorStore((s) => s.petInstalled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petEnabled = useEditorStore((s) => s.petEnabled);
  const selectPet = useEditorStore((s) => s.selectPet);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const showToast = useEditorStore((s) => s.showToast);
  const ensurePetsReady = useEditorStore((s) => s.ensurePetsReady);

  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef(null);

  const filteredPets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pets = [...petInstalled].sort((a, b) =>
      (a.displayName || a.slug).localeCompare(b.displayName || b.slug),
    );
    if (!needle) return pets;
    return pets.filter(
      (pet) =>
        pet.displayName?.toLowerCase().includes(needle) || pet.slug?.toLowerCase().includes(needle),
    );
  }, [petInstalled, query]);

  const close = useCallback(() => {
    setShowPetPalette(false);
    setQuery("");
    setHighlightIdx(0);
  }, [setShowPetPalette]);

  useEffect(() => {
    if (!showPetPalette) return undefined;
    void ensurePetsReady?.();
    setHighlightIdx(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [showPetPalette, ensurePetsReady]);

  useEffect(() => {
    if (highlightIdx >= filteredPets.length) {
      setHighlightIdx(Math.max(0, filteredPets.length - 1));
    }
  }, [filteredPets.length, highlightIdx]);

  const adoptPet = useCallback(
    async (slug) => {
      const res = await selectPet(slug);
      if (res.ok) {
        showToast({ kind: "ok", text: t("settings.petdex.selected") });
        close();
        return;
      }
      showToast({ kind: "err", text: res.error || t("settings.petdex.selectFailed") });
    },
    [selectPet, showToast, t, close],
  );

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIdx((idx) => Math.min(idx + 1, Math.max(0, filteredPets.length - 1)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIdx((idx) => Math.max(idx - 1, 0));
        return;
      }
      if (event.key === "Enter" && filteredPets[highlightIdx]) {
        event.preventDefault();
        void adoptPet(filteredPets[highlightIdx].slug);
      }
    },
    [close, filteredPets, highlightIdx, adoptPet],
  );

  if (!showPetPalette) return null;

  return (
    <div className="cap-modal-overlay cap-modal-overlay--stack" onClick={close}>
      <div
        className="cap-modal-panel pet-palette-modal"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-labelledby="pet-palette-title"
      >
        <header className="pet-palette-head">
          <div className="pet-palette-head-brand">
            <PawPrint size={14} strokeWidth={2.25} />
            <span id="pet-palette-title">{t("settings.petdex.paletteTitle")}</span>
          </div>
          <button
            type="button"
            className="pet-palette-close"
            onClick={close}
            aria-label={t("common.close")}
          >
            <X size={14} />
          </button>
        </header>

        <label className="pet-palette-search">
          <Search size={13} />
          <input
            ref={inputRef}
            type="search"
            className="cap-input"
            value={query}
            placeholder={t("settings.petdex.paletteSearch")}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightIdx(0);
            }}
          />
        </label>

        <div className="pet-palette-list" role="listbox">
          {filteredPets.length === 0 ? (
            <p className="pet-palette-empty">{t("settings.petdex.paletteEmpty")}</p>
          ) : (
            filteredPets.map((pet, index) => {
              const isActive = pet.slug === petActiveSlug;
              const isHighlighted = index === highlightIdx;
              return (
                <button
                  key={pet.slug}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`pet-palette-item${isActive ? " pet-palette-item--active" : ""}${isHighlighted ? " pet-palette-item--highlight" : ""}`}
                  onMouseEnter={() => setHighlightIdx(index)}
                  onClick={() => adoptPet(pet.slug)}
                >
                  <div className="pet-palette-item-preview">
                    <PetPreviewSprite
                      slug={pet.slug}
                      remoteSrc={pet.spritesheetUrl}
                      installed
                      scale={0.34}
                      label={pet.displayName}
                    />
                  </div>
                  <div className="pet-palette-item-copy">
                    <span className="pet-palette-item-name">{pet.displayName || pet.slug}</span>
                    <span className="pet-palette-item-slug">
                      {pet.source === "codex" ? t("settings.petdex.badgeCodex") : pet.slug}
                    </span>
                  </div>
                  {isActive ? <Check size={14} className="pet-palette-item-check" /> : null}
                </button>
              );
            })
          )}
        </div>

        <footer className="pet-palette-foot">
          <button
            type="button"
            className={`pet-palette-toggle${petEnabled ? " pet-palette-toggle--on" : ""}`}
            disabled={!petActiveSlug}
            onClick={() => setPetEnabled(!petEnabled)}
          >
            <Power size={12} />
            {petEnabled ? t("settings.petdex.petOn") : t("settings.petdex.petOff")}
          </button>
          <button
            type="button"
            className="cap-btn-secondary pet-palette-gallery-btn"
            onClick={() => {
              close();
              openSettingsTab("pets");
            }}
          >
            <Settings size={12} />
            {t("settings.petdex.paletteBrowse")}
          </button>
        </footer>
      </div>
    </div>
  );
}
