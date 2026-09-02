import React from "react";
import { Link } from "react-router-dom";
import { format, isValid, parseISO } from "date-fns";
import { ArrowRight, ScrollText } from "lucide-react";

/**
 * Recent permission-change trail.
 *
 * Every entry records the administrator account, the affected role, the
 * permission, its previous and new value, and the timestamp.
 */
const formatStamp = (value) => {
  const date = typeof value === "string" ? parseISO(value) : new Date(value);
  return isValid(date) ? format(date, "dd MMM yyyy · HH:mm") : "—";
};

const ValuePill = ({ value }) => (
  <span
    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
      value ? "bg-brand-light text-brand-blue" : "bg-slate-100 text-slate-500"
    }`}
  >
    {value ? "Allowed" : "Denied"}
  </span>
);

export default function PermissionAuditFeed({ entries = [], limit = 6, viewAllTo = null }) {
  const visible = entries.slice(0, limit);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
            <ScrollText className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div>
            <h3 className="font-heading text-[15px] font-semibold text-slate-900">Permission audit trail</h3>
            <p className="mt-0.5 text-xs text-slate-500">Every change is recorded with its previous value.</p>
          </div>
        </div>
        {viewAllTo && entries.length > 0 && (
          <Link
            to={viewAllTo}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-blue hover:underline"
          >
            Full trail
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        )}
      </header>

      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          No permission changes recorded yet. Saved changes will appear here.
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {visible.map((entry) => (
            <li key={entry.id} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    entry.newValue ? "bg-brand-blue" : "bg-brand-gray"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-slate-800">{entry.summary}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ValuePill value={entry.previousValue} />
                    <ArrowRight className="h-3 w-3 text-slate-400" strokeWidth={2.4} />
                    <ValuePill value={entry.newValue} />
                    {entry.moduleLabel && (
                      <span className="text-[11px] text-slate-400">· {entry.moduleLabel}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {entry.actorName}
                    {entry.actorEmail ? ` (${entry.actorEmail})` : ""} · {formatStamp(entry.timestamp)}
                    {entry.source === "reset" ? " · reset to defaults" : ""}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
