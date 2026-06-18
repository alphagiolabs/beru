export default function UpdateChangelog({ sections, t }) {
  const blocks = [
    { key: "whatsNew", title: t("updater.sections.whatsNew"), items: sections.whatsNew },
    { key: "fixed", title: t("updater.sections.fixed"), items: sections.fixed },
  ].filter((block) => block.items.length > 0);

  if (blocks.length === 0) return null;

  return (
    <div className="status-footer-update-changelog">
      {blocks.map((block) => (
        <div key={block.key} className="status-footer-update-changelog-section">
          <p className="status-footer-update-changelog-heading">{block.title}</p>
          <ul className="status-footer-update-changelog-list">
            {block.items.map((line) => (
              <li key={`${block.key}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
