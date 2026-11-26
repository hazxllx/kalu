// frontend/src/features/health-records/components/TclTabs.jsx
import React, { useId } from "react";

// Renders or manages TclTabs logic.
export default function TclTabs({ tabs, active, onChange, label = "TCL sections", className = "", idPrefix, panelId }) {
  const generatedId = useId().replace(/:/g, "");
  const prefix = idPrefix || `tcl-tabs-${generatedId}`;
  const selectAt = (index) => {
    const next = tabs[index];
    if (!next) return;
    onChange(next.value);
    if (typeof document !== "undefined") document.getElementById(`${prefix}-${index}`)?.focus();
  };

  return (
    <div className={`ui-tcl-tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          id={`${prefix}-${index}`}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          aria-controls={panelId}
          tabIndex={active === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            selectAt(next);
          }}
          className={`ui-tcl-tab ${active === tab.value ? "active" : ""}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
