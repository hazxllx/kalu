import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * "Back to TCL List" control shown at the top-left of every TCL form page.
 * It is a real navigation link (not decorative) to the central TCL workspace.
 * `to` defaults to the sibling `tcls` route (works for every role area, e.g.
 * /app/health_supervisor/ncd -> /app/health_supervisor/tcls).
 */
export default function BackToTclButton({ to = "../tcls" }) {
  return (
    <Link
      to={to}
      className="mb-3 inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
      aria-label="Back to TCL List"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to TCL List
    </Link>
  );
}
