import React from "react";

export default function TclTabs({ tabs, active, onChange, label = "TCL sections" }) {
  return (
    <div className="ui-tcl-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`ui-tcl-tab ${active === tab.value ? "active" : ""}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
