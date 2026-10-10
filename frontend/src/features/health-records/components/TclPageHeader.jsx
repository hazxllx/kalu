import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

/**
 * Header shared by the individual TCL form pages. It keeps this area's
 * specialized workflow control — the "Back to TCL List" link — while adopting
 * the same institutional navy/gold banner the shared PageHeader uses, so the
 * TCL sub-pages stay visually consistent with the rest of the system. Reuses
 * the existing `brand.*` palette, heading font, `tracking-gov`, `rounded-card`
 * and `shadow-card`; introduces no new tokens.
 */
export default function TclPageHeader({ title, subtitle = "", crumb, backTo = "../tcls" }) {
  return (
    <section
      aria-label={typeof title === "string" ? `${title} header` : "Page header"}
      className="mb-6 overflow-hidden rounded-card border border-brand-deep bg-brand-dark text-white shadow-card"
    >
      <div aria-hidden="true" className="h-0.5 w-full bg-brand-gold/70" />
      <div className="flex flex-col gap-4 px-5 py-6 md:px-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold uppercase tracking-gov"
          >
            <Link to={backTo} className="truncate text-white/70 transition-colors hover:text-white">
              Records
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0 text-white/40" aria-hidden="true" />
            <Link to={backTo} className="truncate text-white/70 transition-colors hover:text-white">
              TCL
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0 text-white/40" aria-hidden="true" />
            <span className="truncate text-brand-goldlight">{crumb}</span>
          </nav>
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white/80 transition-colors hover:text-white"
            aria-label="Back to TCL List"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to TCL List
          </Link>
        </div>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-white md:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-prose break-words text-sm leading-relaxed text-white/70">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
