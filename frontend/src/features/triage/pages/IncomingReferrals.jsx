import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { referralsApi } from "@/services/api";
import { filterOpenReferrals } from "@/features/triage/lib/triageWorkflow";
import { AlertCircle, RefreshCw, Search, Stethoscope } from "lucide-react";

const nameOf = (resident = {}) => [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(" ") || "Unnamed resident";
const dateTime = (value) => value ? new Date(value).toLocaleString() : "Not scheduled";

export default function IncomingReferrals() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Open");
  const [priority, setPriority] = useState("All");
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await referralsApi.list();
      setRows(result?.rows || []);
    } catch (err) {
      setError(err?.message || "Could not load incoming referrals.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "Open" ? !filterOpenReferrals([row]).length : status !== "All" && row.status !== status) return false;
      if (priority !== "All" && row.priority !== priority) return false;
      if (!needle) return true;
      const resident = row.resident || {};
      return [nameOf(resident), resident.barangay, row.referring_facility, row.reason, row.chief_complaints, row.destination_facility]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [rows, search, status, priority]);

  const beginScreening = async (referral) => {
    let details = referral;
    if (!details.encounter) {
      try {
        const result = await referralsApi.get(referral.id);
        details = result?.record || referral;
      } catch {
        // The triage route will display the authoritative API error if details
        // cannot be loaded; no local referral data is used to create a record.
      }
    }
    if (details.encounter && details.encounter.status !== "draft") {
      setSelected(details);
      return;
    }
    navigate("/app/rhu_personnel/triage", { state: { referralToScreen: details } });
  };

  const openDetails = async (row) => {
    setSelected(row);
    setDetailLoading(true);
    try {
      const result = await referralsApi.get(row.id);
      setSelected(result?.record || row);
    } catch {
      // Keep the list data visible if the detail request fails.
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader crumbs={["RHU", "Incoming Referrals"]} title="Incoming Referrals" subtitle="Review barangay referrals, confirm arrival, and start RHU screening." />
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-btn border border-brand-border bg-brand-bg/50 px-3 py-2.5">
            <Search className="h-4 w-4 text-brand-gray" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resident, barangay, reason…" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm">
            <option value="Open">Open referrals</option><option value="All">All statuses</option><option>Pending</option><option>Accepted</option><option>In Progress</option><option>Completed</option><option>Cancelled</option>
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm">
            <option value="All">All priorities</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </Card>

      {error && <Card className="flex items-center gap-2 p-4 text-sm text-brand-danger"><AlertCircle className="h-4 w-4" />{error}</Card>}
      <Card className="overflow-hidden">
        {loading ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-brand-gray"><RefreshCw className="h-4 w-4 animate-spin" />Loading referrals…</div> : filtered.length === 0 ? (
          <div className="px-4 py-14 text-center"><Stethoscope className="mx-auto mb-2 h-7 w-7 text-brand-gray/60" /><p className="text-sm font-medium text-brand-ink">No incoming referrals need attention</p><p className="mt-1 text-xs text-brand-gray">Try another filter or refresh the list.</p></div>
        ) : (
          <ul className="divide-y divide-brand-border/70">
            {filtered.map((row) => {
              const resident = row.resident || {};
              const name = nameOf(resident);
              return <li key={row.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:px-5">
                <button type="button" onClick={() => void openDetails(row)} className="min-w-0 text-left">
                  <p className="truncate text-sm font-semibold text-brand-ink">{name}</p>
                  <p className="mt-1 text-xs text-brand-gray">{resident.barangay || "Barangay not recorded"} · {row.referring_facility || "Referring facility not recorded"} · {dateTime(row.scheduled_at)}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-brand-gray">{row.reason || row.chief_complaints || "Referral reason not recorded"}</p>
                </button>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.priority === "High" ? "bg-brand-danger/10 text-brand-danger" : row.priority === "Medium" ? "bg-brand-yellow/15 text-[#9A7000]" : "bg-brand-green/10 text-brand-green"}`}>{row.priority || "Medium"}</span>
                  <StatusBadge value={row.stage?.label || row.status} />
                  <button type="button" onClick={() => row.stage?.key === "awaiting_rhu" ? void beginScreening(row) : void openDetails(row)} className="rounded-btn bg-brand-blue px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark">{row.stage?.key === "awaiting_rhu" ? "Begin screening" : "Review progress"}</button>
                </div>
              </li>;
            })}
          </ul>
        )}
      </Card>

      {selected && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="incoming-referral-title">
            <div className="flex items-start justify-between gap-3"><div><h2 id="incoming-referral-title" className="text-lg font-semibold text-brand-ink">{nameOf(selected.resident)}</h2><p className="text-sm text-brand-gray">{selected.resident?.current_address || selected.resident?.permanent_address || selected.resident?.barangay || "Address not recorded"}</p></div><button type="button" onClick={() => setSelected(null)} className="text-sm text-brand-blue">Close</button></div>
            {detailLoading ? <p className="mt-4 text-sm text-brand-gray">Loading referral and screening details…</p> : null}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-brand-gray">Referring facility / barangay</dt><dd>{selected.referring_facility || "Not recorded"} · {selected.resident?.barangay || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-brand-gray">Scheduled referral</dt><dd>{dateTime(selected.scheduled_at)}</dd></div>
              <div><dt className="text-xs text-brand-gray">Priority / status</dt><dd>{selected.priority || "Medium"} · {selected.stage?.label || selected.status}</dd></div>
              <div><dt className="text-xs text-brand-gray">Destination</dt><dd>{[selected.destination_facility, selected.destination_service].filter(Boolean).join(" · ") || "Not recorded"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-brand-gray">Chief complaints</dt><dd className="whitespace-pre-wrap">{selected.chief_complaints || "Not recorded"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-brand-gray">Medical history</dt><dd className="whitespace-pre-wrap">{selected.medical_history || "Not recorded"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-brand-gray">PPE / physical examination</dt><dd className="whitespace-pre-wrap">{selected.physical_exam_findings || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-brand-gray">Impression</dt><dd>{selected.impression || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-brand-gray">Reason for referral</dt><dd>{selected.reason || "Not recorded"}</dd></div>
              {selected.encounter && <>
                <div className="sm:col-span-2 rounded-btn bg-brand-bg p-3"><dt className="text-xs text-brand-gray">RHU screening progress</dt><dd className="mt-1">{selected.encounter.status} · screened by {selected.encounter.recorded_by_name || "Personnel not recorded"}{selected.encounter.received_at ? ` · arrived ${new Date(selected.encounter.received_at).toLocaleString()}` : ""}</dd></div>
                <div><dt className="text-xs text-brand-gray">Triage findings</dt><dd className="whitespace-pre-wrap">{selected.encounter.clinical_history || selected.encounter.findings || "Not recorded"}</dd></div>
                <div><dt className="text-xs text-brand-gray">Updated reason / complaints</dt><dd className="whitespace-pre-wrap">{selected.encounter.chief_complaint || "Not recorded"}</dd></div>
                <div><dt className="text-xs text-brand-gray">Updated vital signs</dt><dd>{[
                  selected.encounter.bp && `BP ${selected.encounter.bp}`,
                  selected.encounter.hr && `HR ${selected.encounter.hr}`,
                  selected.encounter.temperature && `Temp ${selected.encounter.temperature}`,
                  selected.encounter.height_cm && `Height ${selected.encounter.height_cm} cm`,
                  selected.encounter.weight_kg && `Weight ${selected.encounter.weight_kg} kg`,
                ].filter(Boolean).join(" · ") || "Not recorded"}</dd></div>
                {selected.encounter.completed_at && <div><dt className="text-xs text-brand-gray">Consultation completed</dt><dd>{new Date(selected.encounter.completed_at).toLocaleString()} · {selected.encounter.phn_personnel || selected.encounter.responsible_personnel_name || "Performer not recorded"}</dd></div>}
              </>}
            </dl>
            {(!selected.encounter || selected.encounter.status === "draft") && <button type="button" onClick={() => void beginScreening(selected)} className="mt-5 w-full rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">{selected.encounter ? "Continue screening draft" : "Confirm arrival and begin screening"}</button>}
          </Card>
        </div>
      )}
    </div>
  );
}
