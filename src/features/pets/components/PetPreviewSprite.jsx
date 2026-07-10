import { useEffect, useRef, useState } from "react";
import { beruLocalUrl } from "../utils/pet-url.js";
import StaticPetSprite from "./StaticPetSprite.jsx";

function useInViewport(rootMargin = "120px") {
  const ref = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = ref.current;
    if (!node || visible || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return { ref, visible };
}

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
  const { ref, visible } = useInViewport();

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;

    const load = async () => {
      if (installed) {
        const res = await window.api?.getPetSpritesheet?.(slug);
        if (!cancelled && res?.success && res.path) {
          setSrc(beruLocalUrl(res.path));
        }
        return;
      }

      const bundled = await window.api?.getBundledSpritesheet?.(slug);
      if (!cancelled && bundled?.success && bundled.path) {
        setSrc(beruLocalUrl(bundled.path));
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
  }, [slug, installed, remoteSrc, visible]);

  return (
    <div ref={ref} className="settings-petdex-card-preview-slot">
      {src ? (
        <StaticPetSprite src={src} scale={scale} label={label} />
      ) : (
        <div className="settings-petdex-card-preview-empty" aria-hidden="true" />
      )}
    </div>
  );
}
