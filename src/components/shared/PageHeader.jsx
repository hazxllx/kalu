import React from "react";
import { ChevronRight } from "lucide-react";

export default function PageHeader({ crumbs = [], title, subtitle = "", action = null }) {
  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-card md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <nav className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                <span className={i === crumbs.length - 1 ? "text-brand-blue font-semibold" : ""}>{c}</span>
              </span>
            ))}
          </nav>
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}