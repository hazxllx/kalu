import React from "react";

export default function ReferralHistory({ history = [] }) {
  return (
    <section aria-label="Referral history" className="space-y-2">
      <h4 className="text-sm font-semibold text-brand-ink">Workflow history</h4>
      {history.length === 0 ? <p className="text-sm text-brand-gray">No history is available.</p> : (
        <ol className="divide-y divide-brand-border rounded-btn border border-brand-border">
          {history.map((entry) => (
            <li key={entry.id || entry.version} className="space-y-1 px-3 py-2.5 text-sm">
              <p className="font-medium text-brand-ink">{entry.action}{entry.previous_status ? `: ${entry.previous_status} to ${entry.new_status}` : `: ${entry.new_status}`}</p>
              <p className="text-xs text-brand-gray">{entry.actor_name || "System"}{entry.actor_role ? ` (${entry.actor_role})` : ""}{entry.created_at ? ` / ${new Date(entry.created_at).toLocaleString()}` : ""}</p>
              {entry.explanation && <p className="whitespace-pre-wrap break-words text-brand-ink">{entry.explanation}</p>}
              {entry.action === "Reassigned" && <p className="text-xs text-brand-gray">Recipient changed. Acceptance was reset for the new recipient.</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
