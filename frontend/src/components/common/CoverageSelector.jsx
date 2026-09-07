import React from "react";
import { MapPin } from "lucide-react";

import { usePhnCoverage } from "@/context/PhnCoverageContext";

/**
 * PHN coverage control.
 *
 * - `mode="switcher"` (default): the interactive control used where the PHN
 *   actually chooses their working scope (the PHN dashboard). A barangay PHN
 *   toggles between their assigned barangay and "RHU"; an RHU-only PHN sees a
 *   single static chip because there is nothing to switch.
 * - `mode="tag"`: a small, non-interactive scope tag for pages whose data is
 *   coverage-scoped. It only *indicates* the current scope — it never repeats
 *   the full switcher, and switching still happens on the dashboard.
 *
 * Coverage itself is shared app-wide through PhnCoverageContext, so every
 * page's data, filters, and workflow stay consistent regardless of which
 * control rendered it.
 */
export default function CoverageSelector({ mode = "switcher", className = "" }) {
  const { coverage, setCoverage, options, canSwitch } = usePhnCoverage();

  if (!options || options.length === 0) return null;

  const active = options.find((o) => o.value === coverage);

  // Subtle indicator used on coverage-scoped pages (never interactive).
  if (mode === "tag") {
    return (
      <span
        title={active?.hint}
        className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 ${className}`}
      >
        <MapPin className="h-3 w-3 text-slate-400" />
        {active?.label || coverage}
      </span>
    );
  }

  // RHU-only PHN (or no alternative coverage): a clear, static label.
  if (!canSwitch) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-ink ${className}`}
        title={active?.hint}
      >
        <MapPin className="w-3.5 h-3.5 text-brand-blue" />
        Coverage: {active?.label || coverage}
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-2 py-1.5 ${className}`}
      role="group"
      aria-label="Coverage"
    >
      <MapPin className="w-3.5 h-3.5 text-brand-blue shrink-0 ml-1" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-gray">
        Coverage
      </span>
      <div className="inline-flex rounded-full bg-brand-bg p-0.5">
        {options.map((opt) => {
          const isActive = coverage === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.hint}
              aria-pressed={isActive}
              onClick={() => setCoverage(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? opt.kind === "barangay"
                    ? "bg-brand-blue text-white shadow-sm"
                    : "bg-brand-ink text-white shadow-sm"
                  : "text-brand-gray hover:text-brand-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
