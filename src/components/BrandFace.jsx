import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";

const EYE_TRAVEL = 5;
const BLINK_MS = 180;

export default function BrandFace() {
  const t = useT();
  const [flipped, setFlipped] = useState(false);
  const orbRef = useRef(null);
  const blinkTimer = useRef(0);
  const blinkOffTimer = useRef(0);

  useEffect(() => {
    if (!flipped) return undefined;

    const orb = orbRef.current;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const onMove = (event) => {
      if (!orb || reduceMotion) return;
      const rect = orb.getBoundingClientRect();
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > EYE_TRAVEL) {
        dx = (dx / dist) * EYE_TRAVEL;
        dy = (dy / dist) * EYE_TRAVEL;
      }
      orb.style.setProperty("--eye-x", `${dx.toFixed(1)}px`);
      orb.style.setProperty("--eye-y", `${dy.toFixed(1)}px`);
    };

    const blink = () => {
      if (!reduceMotion) orb?.style.setProperty("--eye-squash", "0.15");
      blinkOffTimer.current = window.setTimeout(() => {
        orb?.style.setProperty("--eye-squash", "1");
      }, BLINK_MS);
      blinkTimer.current = window.setTimeout(blink, 2800 + Math.random() * 3200);
    };

    window.addEventListener("mousemove", onMove);
    blinkTimer.current = window.setTimeout(blink, 2600);

    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(blinkTimer.current);
      clearTimeout(blinkOffTimer.current);
      orb?.style.setProperty("--eye-squash", "1");
    };
  }, [flipped]);

  const toggle = useCallback(() => setFlipped((v) => !v), []);

  return (
    <button
      type="button"
      className={`brand-face${flipped ? " brand-face--flipped" : ""}`}
      onClick={toggle}
      aria-label={t("landing.mascot")}
      aria-pressed={flipped}
      title={t("landing.mascot")}
    >
      <span className="brand-face-inner">
        <span className="brand-face-side brand-face-front" aria-hidden="true">
          <svg viewBox="0 0 300 400" className="brand-face-mark">
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
            />
          </svg>
        </span>
        <span className="brand-face-side brand-face-back" aria-hidden="true">
          <span ref={orbRef} className="brand-face-orb">
            <span className="brand-face-eye" />
            <span className="brand-face-eye" />
          </span>
        </span>
      </span>
    </button>
  );
}
