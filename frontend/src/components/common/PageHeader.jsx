import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Shared page header used by every role area.
 *
 * Design direction: the Monthly Health Services report masthead — a solid
 * institutional navy band drawn from the existing brand palette, finished with
 * a hairline gold accent rule (the official token). It is deliberately NOT a
 * new design system: it reuses `brand.*` colours, the project heading font,
 * `tracking-gov` letter-spacing, `rounded-card`/`shadow-card`, and the same
 * `max-w-content` width the layout already applies.
 *
 * Consistent structure everywhere:
 *   eyebrow / category ............... [optional meta]
 *   Title                            [optional action]
 *   Description
 *
 * Backwards compatible props (unchanged call sites keep working):
 *   - crumbs: still accepted. When no explicit `eyebrow` is passed the crumbs
 *     render as the eyebrow/category row, with clickable parents preserved so
 *     existing navigation keeps functioning. The current (last) crumb reads as
 *     the active category.
 *   - title / subtitle / action / meta: unchanged roles.
 *
 * New props:
 *   - eyebrow: an explicit uppercase category label that overrides `crumbs`
 *     for the eyebrow row (e.g. "Records", "Immunization").
 *   - leadingAction: optional content (such as a Back button) shown before the
 *     category label in the eyebrow row.
 *   - variant: "default" | "report". The "report" variant adds the
 *     "Official Record" chip used by statutory report pages (e.g. the FHSIS
 *     Form M1 consolidated report).
 *   - dense: an opt-in compact layout that trims the band's vertical padding and
 *     scales the title down one step. Default false keeps every existing call
 *     site identical; pages that need more room above the fold (e.g. the TCL
 *     workspace) can opt in without a separate header component.
 *   - management: an opt-in compact layout for management page banners.
 */
/**
 * @param {{
 *   crumbs?: Array<string|{label: string, to?: string}>,
 *   eyebrow?: string,
 *   title: import("react").ReactNode,
 *   titleClassName?: string,
 *   subtitle?: string,
 *   subtitleClassName?: string,
 *   action?: import("react").ReactNode,
 *   leadingAction?: import("react").ReactNode,
 *   meta?: import("react").ReactNode,
 *   eyebrowClassName?: string,
 *   variant?: "default" | "report",
 *   dense?: boolean,
 *   management?: boolean
 * }} props
 */
export default function PageHeader({
  crumbs = [],
  eyebrow = null,
  title,
  titleClassName = "",
  subtitle = "",
  action = null,
  leadingAction = null,
  meta = null,
  eyebrowClassName = "text-brand-goldlight",
  subtitleClassName = "text-white/70",
  variant = "default",
  dense = false,
  management = false,
}) {
  const isReport = variant === "report";
  const hasCrumbs = Array.isArray(crumbs) && crumbs.length > 0;
  const showEyebrowRow = isReport || Boolean(eyebrow) || hasCrumbs || Boolean(meta) || Boolean(leadingAction);
  const breadcrumbRoutes = { Admin: "/app/admin/dashboard" };

  return (
    <section
      aria-label={typeof title === "string" ? `${title} header` : "Page header"}
      className={`ui-page-header ${management ? "admin-management-header mb-4 min-h-[140px]" : dense ? "mb-4" : "mb-6"} overflow-hidden rounded-lg border border-brand-deep bg-brand-dark text-white shadow-card`}
    >
      {/* Hairline gold rule — the official accent token, no gradient. */}
      <div aria-hidden="true" className="ui-page-header-rule h-0.5 w-full bg-brand-gold/70" />
      <div className={`ui-page-header-body flex flex-col ${management ? "min-h-[138px] justify-center gap-2 px-5 py-5 md:px-6" : dense ? "gap-3 px-5 py-4 md:px-7" : "gap-4 px-5 py-6 md:px-7"}`}>
        {showEyebrowRow && (
          <div className="ui-page-header-eyebrow flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {leadingAction}
              {isReport && (
                <span className="inline-flex items-center rounded-sm border border-white/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/85">
                  Official Record
                </span>
              )}
              {eyebrow ? (
                <span className={`${management ? "text-[11px]" : "text-[10px]"} font-semibold uppercase tracking-[0.08em] ${eyebrowClassName}`}>
                  {eyebrow}
                </span>
              ) : hasCrumbs ? (
                <nav
                  aria-label="Breadcrumb"
                  className={`flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 font-body font-semibold uppercase leading-4 tracking-[0.5px] ${management ? "text-[11px]" : "text-xs"}`}
                >
                  {crumbs.map((crumb, i) => {
                    const isCurrent = i === crumbs.length - 1;
                    const label = typeof crumb === "string" ? crumb : crumb.label;
                    const to = !isCurrent && typeof crumb === "object" && crumb !== null
                      ? crumb.to
                      : !isCurrent && typeof crumb === "string"
                        ? breadcrumbRoutes[crumb]
                        : null;
                    return (
                      <span key={`${label}-${i}`} className="flex min-w-0 items-center gap-2.5">
                        {i > 0 && (
                          <ChevronRight className="h-3 w-3 shrink-0 text-[#8FA6C0]" aria-hidden="true" />
                        )}
                        {isCurrent ? (
                          <span aria-current="page" className="truncate text-[#F59E0B]">{label}</span>
                        ) : to ? (
                          <Link
                            to={to}
                            className="truncate text-[#A9BCD3] transition-colors hover:text-white"
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="truncate text-[#A9BCD3]">{label}</span>
                        )}
                      </span>
                    );
                  })}
                </nav>
              ) : null}
            </div>
             {meta && (
               <div className="ui-page-header-meta flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{meta}</div>
            )}
          </div>
        )}
        <div className={`ui-page-header-main flex flex-col md:flex-row md:items-end md:justify-between ${management || dense ? "gap-3" : "gap-4"}`}>
          <div className="min-w-0 w-full flex-1 md:w-auto">
            <h1 className={`break-words font-heading font-semibold leading-tight tracking-tight text-white ${management ? "text-[26px]" : dense ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"} ${titleClassName}`}>
              {title}
            </h1>
            {subtitle && (
              <p className={`break-words font-body text-sm font-normal leading-relaxed ${subtitleClassName} ${management || dense ? "mt-1.5" : "mt-2 max-w-prose"}`}>
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="ui-page-header-actions w-full shrink-0 md:w-auto">{action}</div>}
        </div>
      </div>
    </section>
  );
}
