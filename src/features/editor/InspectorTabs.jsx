import { useId, useRef, useState } from "react";

export default function InspectorTabs({ label, tabs }) {
  const baseId = useId();
  const listRef = useRef(null);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const current = tabs.some((tab) => tab.id === activeId) ? activeId : tabs[0].id;

  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setActiveId(next.id);
    listRef.current?.ownerDocument.getElementById(`${baseId}-${next.id}`)?.focus();
  };

  return (
    <>
      {tabs.length > 1 ? (
        <div
          ref={listRef}
          className="editor-tabs"
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`${baseId}-${tab.id}`}
              type="button"
              role="tab"
              className="editor-tab"
              aria-selected={tab.id === current}
              aria-controls={`${baseId}-${tab.id}-panel`}
              tabIndex={tab.id === current ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-${tab.id}-panel`}
          role={tabs.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={tabs.length > 1 ? `${baseId}-${tab.id}` : undefined}
          hidden={tab.id !== current}
        >
          {tab.content}
        </div>
      ))}
    </>
  );
}
