export default function FooterChip({ children, className = "", title, onClick, active }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`status-footer-chip ${active ? "status-footer-chip--active" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
