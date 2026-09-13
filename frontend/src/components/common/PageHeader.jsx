import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Shared page header used by every role area.
 *
 * Layout (one consistent structure everywhere):
 *   breadcrumbs ....................... [optional meta]
 *   Title / subtitle ................. [optional action]
 *
 * Breadcrumbs:
 *   - Never automatically prepend "Home" — the sidebar owns global navigation.
 *   - Accepts strings ("Reports") or objects ({ label, to }) so meaningful
 *     parent sections can be clickable.
 *   - The current page (last crumb) is emphasized in primary blue and is
 *     never a link.
 *   - Wraps responsively on small screens with no horizontal overflow.
 *
 * `meta` is an opt-in slot for controls that genuinely belong to the page.
 */
export default function PageHeader({ crumbs = [], title, subtitle = "", action = null, meta = null }) {
  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-card dark:border-border dark:bg-card md:px-6">
      <div className="flex items-start justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold uppercase tracking-[0.18em]">
          {crumbs.map((crumb, i) => {
            const isCurrent = i === crumbs.length - 1;
            const label = typeof crumb === "string" ? crumb : crumb.label;
            const to = typeof crumb === "object" && crumb !== null ? crumb.to : null;
            return (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
                {isCurrent ? (
                  <span className="truncate font-semibold text-brand-blue dark:text-brand-blue">{label}</span>
                ) : to ? (
                  <Link
                    to={to}
                    className="truncate text-slate-500 transition-colors hover:text-brand-blue dark:text-slate-400 dark:hover:text-brand-blue"
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="truncate text-slate-500 dark:text-slate-400">{label}</span>
                )}
              </span>
            );
          })}
        </nav>
        {meta && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{meta}</div>}
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900 dark:text-foreground md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 break-words text-sm leading-relaxed text-slate-600 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

