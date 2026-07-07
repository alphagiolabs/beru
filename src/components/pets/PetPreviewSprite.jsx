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
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setSrc("");

      if (installed) {
        const res = await window.api?.getPetSpritesheet?.(slug);
        if (!cancelled && res?.success && res.dataUrl) {
          setSrc(res.dataUrl);
        }
        return;
      }

      const bundled = await window.api?.getBundledSpritesheet?.(slug);
      if (!cancelled && bundled?.success && bundled.dataUrl) {
        setSrc(bundled.dataUrl);
        return;
      }

      if (!cancelled && remoteSrc) {
        setSrc(remoteSrc);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, installed, remoteSrc]);

  if (!src) {
    return <div className="settings-petdex-card-preview-empty" aria-hidden="true" />;
  }

  return <StaticPetSprite src={src} scale={scale} label={label} />;
}
