import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { REFERRAL_STATUSES } from "@/services/local/referralTrackingStore";
import { referralsApi } from "@/services/api/referralsApi";
import { Search, X, AlertTriangle, RefreshCw, ChevronRight, Inbox } from "lucide-react";

/* Status + priority badge tones shared by the RHU and MHO referral pages. */
const STATUS_TONES = {
  Pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Accepted: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  "In Progress": "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
};
const PRIORITY_TONES = {
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Medium: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Low: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

export function ReferralStatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[value] || STATUS_TONES.Pending}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {value}
    </span>
  );
}

export function PriorityBadge({ value }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_TONES[value] || PRIORITY_TONES.Medium}`}>
      {value}
    </span>
  );
}

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/* ------------------------------------------------------------------ */
/* Backend (health_referrals) row → view model used by this page.     */
/* RHU Personnel have READ access to referrals in their municipality  */
/* (see backend referrals.service MUNICIPALITY_ROLES); they do not     */
/* create or update them, so this page is view-only.                   */
/* ------------------------------------------------------------------ */
const fullName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name].map((p) => String(p || "").trim()).filter(Boolean).join(" ") || "—";

const ageFromBirthDate = (birthDate) => {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

const toViewModel = (row) => {
  const resident = row.resident || {};
  const service = String(row.destination_service || "").trim();
  const facility = String(row.destination_facility || "").trim();
  return {
    id: row.id,
    patientName: fullName(resident),
    patientId: row.resident_id || resident.id || "—",
    barangay: resident.barangay || "—",
    sex: resident.sex || "—",
    age: ageFromBirthDate(resident.birth_date),
    reason: row.reason || "—",
    referringFacility: row.referring_facility || "—",
    destinationFacility: facility || "—",
    destinationService: service,
    referredTo: [facility, service].filter(Boolean).join(" · ") || "—",
    date: row.referral_date || row.created_at || null,
    createdAt: row.created_at || null,
    priority: row.priority || "Medium",
    status: row.status || "Pending",
    notes: row.notes || "",
    resolutionNotes: row.resolution_notes || "",
  };
};

/**
 * RHU Referrals — track patients referred to PHN and higher-level facilities.
 *
 * Reads real, persisted referral records from the backend (`GET /api/referrals`,
 * Supabase `health_referrals`). RHU Personnel can view referrals within their
 * municipality but do not create or change status here (that is a PHN / Health
 * Supervisor action), so the page is view-only.
 */
export default function RhuReferrals() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // loadError distinguishes "the request failed" from "there are no records".
  const [loadError, setLoadError] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [detail, setDetail] = useState(null); // referral id

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    referralsApi
      .list()
      .then((payload) => {
        const list = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload) ? payload : [];
        setRows(list.map(toViewModel));
      })
      .catch((err) => {
        setRows([]);
        setLoadError(
          err?.status === 401 || err?.status === 403
            ? "You don't have access to view referrals. Please contact your administrator."
            : "We couldn't load referrals. Please try again."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasActiveFilters = query.trim() !== "" || statusFilter !== "All" || priorityFilter !== "All";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => priorityFilter === "All" || r.priority === priorityFilter)
      .filter(
        (r) =>
          !q ||
          r.patientName.toLowerCase().includes(q) ||
          String(r.patientId).toLowerCase().includes(q) ||
          r.destinationFacility.toLowerCase().includes(q) ||
          r.barangay.toLowerCase().includes(q)
      )
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [rows, query, statusFilter, priorityFilter]);

  const detailRecord = detail ? rows.find((r) => r.id === detail) : null;

  return (
    <>
      <PageHeader
        crumbs={["Referrals"]}
        title="Referrals"
        subtitle="Track patients referred to PHN and monitor their referral status."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient, ID, facility, or barangay..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Statuses</option>
            {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Priorities</option>
            {["High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-gray">
            {loading ? "Loading…" : `${filtered.length} referral${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Loading state — never flash an empty state before the request resolves. */}
        {loading ? (
          <div className="px-5 py-4">
            <p className="mb-3 text-sm text-brand-gray">Loading referrals…</p>
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-btn bg-brand-bg" />
              ))}
            </div>
          </div>
        ) : loadError ? (
          /* Error state — clearly different from "no records". */
          <div className="px-5 py-12 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-brand-danger/70" />
            <p className="mt-3 text-sm font-medium text-brand-ink">{loadError}</p>
            <button
              onClick={load}
              className="mt-4 inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Try Again
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="bg-brand-bg text-left">
                    <th className="px-5 py-3 font-medium text-brand-gray">Patient</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Patient ID</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Reason</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Referred To</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Date</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Priority</th>
                    <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                    <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-border">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-brand-bg/50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-brand-ink">{r.patientName}</p>
                        <p className="text-xs text-brand-gray">{r.barangay}</p>
                      </td>
                      <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{r.patientId}</td>
                      <td className="px-5 py-3 text-brand-gray">{r.reason}</td>
                      <td className="px-5 py-3 text-brand-gray">{r.referredTo}</td>
                      <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-5 py-3"><PriorityBadge value={r.priority} /></td>
                      <td className="px-5 py-3"><ReferralStatusBadge value={r.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => setDetail(r.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                          View Details <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty states — distinguish "no records yet" from "filtered out". */}
            {filtered.length === 0 && (
              <div className="px-5 py-12 text-center">
                {hasActiveFilters ? (
                  <>
                    <Search className="mx-auto h-8 w-8 text-brand-gray/50" />
                    <p className="mt-3 text-sm font-medium text-brand-ink">No referrals match your current filters.</p>
                    <p className="mt-1 text-xs text-brand-gray">Try adjusting your search, status, or priority filters.</p>
                    <button
                      onClick={() => { setQuery(""); setStatusFilter("All"); setPriorityFilter("All"); }}
                      className="mt-4 inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <Inbox className="mx-auto h-8 w-8 text-brand-gray/50" />
                    <p className="mt-3 text-sm font-medium text-brand-ink">No referrals have been created yet.</p>
                    <p className="mt-1 text-xs text-brand-gray">
                      Referrals appear here once a patient is sent to the PHN and a referral is generated.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {detailRecord && (
        <RhuReferralDetail record={detailRecord} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

/**
 * Read-only referral detail for RHU Personnel. Shows patient information,
 * referral information, reason, destination, referring facility, created date,
 * current status and any notes. RHU Personnel cannot change referral status,
 * so no update action is presented (that is a PHN / Health Supervisor action).
 */
function RhuReferralDetail({ record, onClose }) {
  const patientRows = [
    { label: "Patient Name", value: record.patientName },
    { label: "Patient ID", value: record.patientId },
    { label: "Age", value: record.age != null ? `${record.age}` : "—" },
    { label: "Sex", value: record.sex },
    { label: "Barangay", value: record.barangay },
  ];
  const referralRows = [
    { label: "Reason for Referral", value: record.reason },
    { label: "Referring Facility", value: record.referringFacility },
    { label: "Referred To", value: record.destinationFacility },
    { label: "Service", value: record.destinationService || "—" },
    { label: "Priority", value: record.priority },
    { label: "Referral Date", value: formatDate(record.date) },
    { label: "Created", value: formatDateTime(record.createdAt) },
  ];

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-card">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-ink">{record.patientName}</p>
            <p className="text-xs text-brand-gray">Referral {record.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <ReferralStatusBadge value={record.status} />
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Patient Information</p>
            <div className="space-y-2">
              {patientRows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
                  <p className="shrink-0 text-brand-gray">{r.label}</p>
                  <p className="min-w-0 text-right font-medium text-brand-ink">{r.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Referral Information</p>
            <div className="space-y-2">
              {referralRows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
                  <p className="shrink-0 text-brand-gray">{r.label}</p>
                  <p className="min-w-0 text-right font-medium text-brand-ink">{r.value}</p>
                </div>
              ))}
            </div>
            {record.notes && (
              <p className="mt-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
                <span className="font-semibold text-brand-ink">Notes:</span> {record.notes}
              </p>
            )}
            {record.resolutionNotes && (
              <p className="mt-2 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
                <span className="font-semibold text-brand-ink">Resolution:</span> {record.resolutionNotes}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared referral detail drawer (used by the MHO referral tracking page). Kept
 * here for backward compatibility with the local referral-tracking store shape;
 * shows full referral info, notes, and the progress timeline, plus an
 * update-status action with an optional tracking note.
 */
export function ReferralDrawer({ record, actor: _actor, onClose, onUpdateStatus }) {
  const [status, setStatus] = useState(record.status);
  const [notes, setNotes] = useState("");

  const rows = [
    { label: "Resident", value: `${record.resident} · ${record.barangay}` },
    { label: "Referring Personnel", value: record.referringPersonnel },
    { label: "Receiving Facility", value: record.receivingFacility },
    { label: "Assigned Personnel", value: record.assignedPersonnel || "—" },
    { label: "Referral Reason", value: record.reason },
    { label: "Referral Date", value: formatDate(record.date) },
    { label: "Latest Update", value: record.history.length ? formatDateTime(record.history[record.history.length - 1].at) : "—" },
  ];

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-card">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-ink">{record.id}</p>
            <p className="text-xs text-brand-gray">{record.resident} · {record.receivingFacility}</p>
          </div>
          <div className="flex items-center gap-2">
            <ReferralStatusBadge value={record.status} />
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Referral Details</p>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
                  <p className="shrink-0 text-brand-gray">{r.label}</p>
                  <p className="min-w-0 text-right font-medium text-brand-ink">{r.value}</p>
                </div>
              ))}
            </div>
            {record.notes && (
              <p className="mt-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
                <span className="font-semibold text-brand-ink">Notes:</span> {record.notes}
              </p>
            )}
          </section>

          {/* Progress timeline */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Referral Progress</p>
            <div className="space-y-3">
              {[...record.history].reverse().map((h, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_TONES[h.status] ? "bg-current " + (STATUS_TONES[h.status].split(" ")[0]) : "bg-slate-300"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-ink">{h.status}</p>
                    <p className="text-xs text-brand-gray">{h.notes}</p>
                    <p className="text-[11px] text-brand-gray">{h.by} · {formatDateTime(h.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Update status */}
          <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Update Status</p>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none cursor-pointer dark:text-foreground"
            >
              {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional tracking note..."
              className="mt-3 w-full resize-none rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:text-foreground"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => onUpdateStatus(status, notes.trim())}
                disabled={status === record.status}
                className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Update
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
