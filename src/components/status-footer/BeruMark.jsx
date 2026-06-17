export default function BeruMark({ size = 44 }) {
  return (
    <svg viewBox="0 0 300 400" width={size} height={Math.round(size * 1.33)} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
      />
    </svg>
  );
}
