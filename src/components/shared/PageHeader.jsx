import React from "react";
import { ChevronRight } from "lucide-react";

/**
 * @param {Object} props
 * @param {string[]} [props.crumbs]
 * @param {React.ReactNode} props.title
 * @param {string} [props.subtitle]
 * @param {React.ReactNode} [props.action]
 */
export default function PageHeader({ crumbs = [], title, subtitle, action = null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div>
        <nav className="flex items-center gap-1.5 text-xs text-brand-gray mb-2">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3 h-3" />}
              <span className={i === crumbs.length - 1 ? "text-brand-blue font-medium" : ""}>{c}</span>
            </span>
          ))}
        </nav>
        <h1 className="text-2xl md:text-3xl font-semibold text-brand-ink tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-brand-gray">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}