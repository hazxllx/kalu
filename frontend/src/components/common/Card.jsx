import React from "react";

export function Card({ className = "", children, ...props }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Section heading used inside a Card. It carries no padding or divider of its
 * own so it aligns flush with the card's content padding, matching the inline
 * `<h3>` + supporting-text pattern used across the PHN screens:
 *   Section title  — text-base / font-semibold / brand ink
 *   Supporting text — text-xs / brand gray
 */
export function CardHeader({ title, subtitle, action = null, className = "" }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-brand-gray">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}