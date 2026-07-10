import { useCallback, useEffect } from "react";
import useEditorStore from "../../../stores/useEditorStore";
import { useT } from "../../../i18n/useT";
import usePetState from "../hooks/usePetState";
import usePetOverlaySync from "../hooks/usePetOverlaySync";
import PetSurface from "./PetSurface.jsx";

export default function DesktopPet() {
  const t = useT();
  const petState = usePetState();
  usePetOverlaySync();

  const petEnabled = useEditorStore((s) => s.petEnabled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petPosition = useEditorStore((s) => s.petPosition);
  const petPoppedOut = useEditorStore((s) => s.petPoppedOut);
  const petScale = useEditorStore((s) => s.petScale);
  const petOpacity = useEditorStore((s) => s.petOpacity);
  const petMovement = useEditorStore((s) => s.petMovement);
  const petSpritesheet = useEditorStore((s) => s.petSpritesheet);
  const petSpritesheetLoading = useEditorStore((s) => s.petSpritesheetLoading);
  const showSettings = useEditorStore((s) => s.showSettings);
  const showPetPalette = useEditorStore((s) => s.showPetPalette);
  const loadPetSpritesheet = useEditorStore((s) => s.loadPetSpritesheet);
  const setPetPosition = useEditorStore((s) => s.setPetPosition);
  const setPetEnabled = useEditorStore((s) => s.setPetEnabled);
  const togglePetPopout = useEditorStore((s) => s.togglePetPopout);
  const syncPetOverlay = useEditorStore((s) => s.syncPetOverlay);

  useEffect(() => {
    if (!petEnabled || !petActiveSlug || petSpritesheet || petSpritesheetLoading) return;
    void loadPetSpritesheet(petActiveSlug);
  }, [petEnabled, petActiveSlug, petSpritesheet, petSpritesheetLoading, loadPetSpritesheet]);

  const handlePositionChange = useCallback(
    (position) => {
      void setPetPosition(position);
    },
    [setPetPosition],
  );

  const handleShiftClick = useCallback(() => {
    void togglePetPopout().then(() => syncPetOverlay(petState));
  }, [togglePetPopout, syncPetOverlay, petState]);

  if (
    !petEnabled ||
    !petActiveSlug ||
    !petSpritesheet ||
    petSpritesheetLoading ||
    showSettings ||
    showPetPalette ||
    petPoppedOut
  ) {
    return null;
  }

  return (
    <PetSurface
      className="desktop-pet"
      state={petState}
      spritesheet={petSpritesheet}
      scale={petScale}
      opacity={petOpacity}
      movement={petMovement}
      position={petPosition}
      onPositionChange={handlePositionChange}
      onShiftClick={handleShiftClick}
      onContextMenu={() => setPetEnabled(false)}
      title={t("settings.petdex.popOutHint")}
    />
  );
}
