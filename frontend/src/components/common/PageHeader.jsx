import React from "react";
import { ChevronRight } from "lucide-react";

/**
 * Shared page header used by every role area.
 *
 * Layout (one consistent structure everywhere):
 *   breadcrumbs ....................... [optional meta]
 *   Title / subtitle ................. [optional action]
 *
 * `meta` is an opt-in slot for controls that genuinely belong to the page
 * (for example the PHN coverage switcher on the PHN dashboard, or a small
 * scope tag on pages whose data is coverage-scoped). Nothing is rendered here
 * automatically — no role badges, no coverage chips.
 */
export default function PageHeader({ crumbs = [], title, subtitle = "", action = null, meta = null }) {
  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-card md:px-6">
      <div className="flex items-start justify-between gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-slate-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={i === crumbs.length - 1 ? "font-semibold text-brand-blue" : ""}>{c}</span>
            </span>
          ))}
        </nav>
        {meta && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{meta}</div>}
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
