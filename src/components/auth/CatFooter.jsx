export default function CatFooter() {
  return (
    <div className="cat-footer" aria-hidden="true">
      <svg
        className="cat-footer-svg"
        viewBox="0 0 120 80"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Body */}
        <ellipse
          className="cat-footer-body"
          cx="60"
          cy="60"
          rx="28"
          ry="18"
        />
        {/* Head */}
        <circle cx="88" cy="48" r="14" />
        {/* Left ear */}
        <path
          className="cat-footer-ear-left"
          d="M80 38 L78 28 L86 35 Z"
        />
        {/* Right ear */}
        <path
          className="cat-footer-ear-right"
          d="M96 38 L98 28 L90 35 Z"
        />
        {/* Left eye */}
        <ellipse
          className="cat-footer-eye-left"
          cx="84"
          cy="48"
          rx="1.8"
          ry="2.5"
          fill="var(--bg-app)"
        />
        {/* Right eye */}
        <ellipse
          className="cat-footer-eye-right"
          cx="92"
          cy="48"
          rx="1.8"
          ry="2.5"
          fill="var(--bg-app)"
        />
        {/* Nose */}
        <circle cx="88" cy="52" r="1" fill="var(--bg-app)" />
        {/* Tail */}
        <path
          className="cat-footer-tail"
          d="M35 58 Q15 50 18 35"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        {/* Front legs */}
        <rect x="48" y="72" width="5" height="8" rx="2" />
        <rect x="58" y="72" width="5" height="8" rx="2" />
      </svg>
    </div>
  );
}
