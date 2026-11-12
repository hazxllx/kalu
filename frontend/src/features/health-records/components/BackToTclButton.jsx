import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Shared "Back to TCL List" header action for TCL pages. It is a real
 * navigation link (not decorative) to the central TCL workspace.
 * `to` defaults to the sibling `tcls` route (works for every role area, e.g.
 * /app/health_supervisor/ncd -> /app/health_supervisor/tcls).
 */
export default function BackToTclButton({ to = "../tcls" }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-white/25 bg-white/5 px-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      aria-label="Back to TCL List"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to TCL List
    </Link>
  );
}
