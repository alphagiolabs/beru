export default function SegmentedProgress({ percent }) {
  const segments = 20;
  const filled = Math.round((percent / 100) * segments);
  return (
    <div className="status-footer-progress" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`status-footer-progress-seg${i < filled ? " status-footer-progress-seg--on" : ""}`}
        />
      ))}
    </div>
  );
}
