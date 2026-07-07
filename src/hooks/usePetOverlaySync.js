import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import usePetState from "./usePetState";

export default function usePetOverlaySync() {
  const petState = usePetState();
  const petEnabled = useEditorStore((s) => s.petEnabled);
  const petActiveSlug = useEditorStore((s) => s.petActiveSlug);
  const petSpritesheet = useEditorStore((s) => s.petSpritesheet);
  const petScale = useEditorStore((s) => s.petScale);
  const petPoppedOut = useEditorStore((s) => s.petPoppedOut);
  const syncPetOverlay = useEditorStore((s) => s.syncPetOverlay);
  const setPetPoppedOut = useEditorStore((s) => s.setPetPoppedOut);
  const setPetPopoutPosition = useEditorStore((s) => s.setPetPopoutPosition);

  useEffect(() => {
    const api = window.api;
    if (!api?.onPetOverlayEvent) return undefined;
    return api.onPetOverlayEvent((payload) => {
      if (payload?.event === "popIn" || payload?.event === "closed") {
        void setPetPoppedOut(false);
      }
      if (payload?.event === "position" && payload.position) {
        void setPetPopoutPosition(payload.position);
      }
    });
  }, [setPetPoppedOut, setPetPopoutPosition]);

  useEffect(() => {
    if (!petPoppedOut) return;
    void syncPetOverlay(petState);
  }, [petPoppedOut, petState, petEnabled, petActiveSlug, petSpritesheet, petScale, syncPetOverlay]);
}
