import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

/**
 * Compact header shared by the individual TCL form pages. Combines the
 * "Back to TCL List" control, a short Records / TCL / <page> breadcrumb, a
 * concise title and an optional one-line description — with tight vertical
 * spacing so the tabs, toolbar and record list sit near the top.
 */
export default function TclPageHeader({ title, subtitle = "", crumb, backTo = "../tcls" }) {
  return (
    <div className="mb-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-gray transition-colors hover:text-brand-blue"
        aria-label="Back to TCL List"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to TCL List
      </Link>
      <nav aria-label="Breadcrumb" className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <Link to={backTo} className="hover:text-brand-blue">Records</Link>
        <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
        <Link to={backTo} className="hover:text-brand-blue">TCL</Link>
        <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
        <span className="text-brand-blue">{crumb}</span>
      </nav>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-brand-ink">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-brand-gray">{subtitle}</p>}
    </div>
  );
}
