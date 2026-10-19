export default function FooterChip({ children, className = "", title }) {
  return (
    <div title={title} className={`status-footer-chip ${className}`}>
      {children}
    </div>
  );
}
