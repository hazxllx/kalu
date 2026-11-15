import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import BackToTclButton from "./BackToTclButton";

/**
 * Header shared by the individual TCL form pages. It keeps this area's
 * specialized workflow control — the "Back to TCL List" link — while adopting
 * the same institutional navy/gold banner the shared PageHeader uses, so the
 * TCL sub-pages stay visually consistent with the rest of the system. Reuses
 * the existing `brand.*` palette, heading font, `tracking-gov`, `rounded-card`
 * and `shadow-card`; introduces no new tokens.
 */
export default function TclPageHeader({ title, subtitle = "", crumb, backTo = "../tcls", action = null, crumbs = null, dense = false }) {
  const headerAction = action || <BackToTclButton to={backTo} />;
  const breadcrumbItems = crumbs || [
    { label: "Records", to: backTo },
    { label: "TCL", to: backTo },
    { label: crumb },
  ];

  return (
    <div className={dense ? "mb-3.5" : "mb-6"}>
      <section
        aria-label={typeof title === "string" ? `${title} header` : "Page header"}
        className="ui-page-header-hs-tcl overflow-hidden rounded-card border border-brand-dark bg-brand-dark text-white shadow-card"
      >
      <div aria-hidden="true" className="h-0.5 w-full bg-brand-gold/70" />
      <div className={`flex flex-col ${dense ? "gap-2 px-4 py-3.5 md:px-6" : "gap-4 px-5 py-6 md:px-7"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold uppercase tracking-gov"
          >
            {breadcrumbItems.map((item, index) => {
              const current = index === breadcrumbItems.length - 1;
              return (
                <React.Fragment key={`${item.label}-${index}`}>
                  {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-white/40" aria-hidden="true" />}
                  {current || !item.to ? (
                    <span className={`truncate ${current ? "text-brand-goldlight" : "text-white/70"}`}>{item.label}</span>
                  ) : (
                    <Link to={item.to} className="truncate text-white/70 transition-colors hover:text-white">{item.label}</Link>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
          <div className="shrink-0">{headerAction}</div>
        </div>
        <div className="min-w-0">
          <h1 className={`break-words font-semibold tracking-tight text-white ${dense ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"}`}>
            {title}
          </h1>
          {subtitle && (
            <p className={`max-w-prose break-words leading-relaxed text-white/70 ${dense ? "mt-1 text-xs" : "mt-2 text-sm"}`}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      </section>
    </div>
  );
}
