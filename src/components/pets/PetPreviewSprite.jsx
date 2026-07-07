import { useEffect, useState } from "react";
import StaticPetSprite from "./StaticPetSprite.jsx";

/**
 * @param {{
 *   slug: string,
 *   remoteSrc?: string,
 *   installed?: boolean,
 *   scale?: number,
 *   label?: string,
 * }} props
 */
export default function PetPreviewSprite({
  slug,
  remoteSrc = "",
  installed = false,
  scale = 0.42,
  label,
}) {
  const [localSrc, setLocalSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLocalSrc("");

    if (!installed || remoteSrc) return undefined;

    const load = async () => {
      const res = await window.api?.getPetSpritesheet?.(slug);
      if (cancelled || !res?.success || !res.dataUrl) return;
      setLocalSrc(res.dataUrl);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, installed, remoteSrc]);

  const src = remoteSrc || localSrc;
  if (!src) {
    return <div className="settings-petdex-card-preview-empty" aria-hidden="true" />;
  }

  return <StaticPetSprite src={src} scale={scale} label={label} />;
}
