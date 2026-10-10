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
 *   - variant: "default" | "report". The "report" variant adds the
 *     "Official Record" chip used by statutory report pages (e.g. the FHSIS
 *     Form M1 consolidated report).
 */
/**
 * @param {{
 *   crumbs?: Array<string|{label: string, to?: string}>,
 *   eyebrow?: string,
 *   title: import("react").ReactNode,
 *   subtitle?: string,
 *   action?: import("react").ReactNode,
 *   meta?: import("react").ReactNode,
 *   variant?: "default" | "report"
 * }} props
 */
export default function PageHeader({
  crumbs = [],
  eyebrow = null,
  title,
  subtitle = "",
  action = null,
  meta = null,
  variant = "default",
}) {
  const isReport = variant === "report";
  const hasCrumbs = Array.isArray(crumbs) && crumbs.length > 0;
  const showEyebrowRow = isReport || Boolean(eyebrow) || hasCrumbs || Boolean(meta);

  return (
    <section
      aria-label={typeof title === "string" ? `${title} header` : "Page header"}
      className="mb-6 overflow-hidden rounded-card border border-brand-deep bg-brand-dark text-white shadow-card"
    >
      {/* Hairline gold rule — the official accent token, no gradient. */}
      <div aria-hidden="true" className="h-0.5 w-full bg-brand-gold/70" />
      <div className="flex flex-col gap-4 px-5 py-6 md:px-7">
        {showEyebrowRow && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {isReport && (
                <span className="inline-flex items-center rounded-[2px] border border-white/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-gov text-white/85">
                  Official Record
                </span>
              )}
              {eyebrow ? (
                <span className="text-[10px] font-semibold uppercase tracking-gov text-brand-goldlight">
                  {eyebrow}
                </span>
              ) : hasCrumbs ? (
                <nav
                  aria-label="Breadcrumb"
                  className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold uppercase tracking-gov"
                >
                  {crumbs.map((crumb, i) => {
                    const isCurrent = i === crumbs.length - 1;
                    const label = typeof crumb === "string" ? crumb : crumb.label;
                    const to = typeof crumb === "object" && crumb !== null ? crumb.to : null;
                    return (
                      <span key={i} className="flex min-w-0 items-center gap-1.5">
                        {i > 0 && (
                          <ChevronRight className="h-3 w-3 shrink-0 text-white/40" aria-hidden="true" />
                        )}
                        {isCurrent ? (
                          <span className="truncate text-brand-goldlight">{label}</span>
                        ) : to ? (
                          <Link
                            to={to}
                            className="truncate text-white/70 transition-colors hover:text-white"
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="truncate text-white/70">{label}</span>
                        )}
                      </span>
                    );
                  })}
                </nav>
              ) : null}
            </div>
            {meta && (
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{meta}</div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-white md:text-3xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-prose break-words text-sm leading-relaxed text-white/70">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="w-full shrink-0 md:w-auto">{action}</div>}
        </div>
      </div>
    </section>
  );
}
