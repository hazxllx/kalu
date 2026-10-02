import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Search, ClipboardList, Stethoscope, CalendarClock, AlertTriangle, Loader2, User, Building2 } from "lucide-react";
import { consultationsApi } from "@/services/api";

/**
 * Consultation History.
 *
 * BUG-020: this page previously rendered hardcoded fake patients/consultations.
 * It now reads REAL, scope-enforced consultations from /api/consultations
 * (the visits workflow, filtered server-side to the caller's barangay/
 * municipality). When there are no records it shows a proper empty state — it
 * never fabricates clinical data.
 */
export default function ConsultationsPage({ showResidentSearch = true }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    consultationsApi
      .list()
      .then((res) => {
        if (!active) return;
        const list = Array.isArray(res) ? res : res?.rows || [];
        setRows(list);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err?.message || "Unable to load consultations.");
        setRows([]);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const completed = useMemo(
    () => rows.filter((r) => String(r.status || "").toLowerCase() === "completed"),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return completed;
    return completed.filter((r) =>
      [r.resident?.name, r.chiefComplaint, r.diagnosis].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [completed, query]);

  return (
    <>
      <PageHeader crumbs={["Consultations"]} title="Consultation History" subtitle={showResidentSearch ? "View completed consultations recorded for residents in your barangay." : "View your completed consultations."} />

      <div className="grid lg:grid-cols-3 gap-5">
        {showResidentSearch && (
          <Card className="p-6 lg:col-span-1 h-fit">
            <h3 className="font-semibold text-brand-ink mb-4">Resident Search</h3>
            <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5">
              <Search className="w-4 h-4 text-brand-gray" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search resident, reason or diagnosis..."
                className="bg-transparent text-sm outline-none w-full"
              />
            </div>
            <p className="mt-4 text-xs text-brand-gray">
              Search filters the completed consultations recorded within your scope.
            </p>
          </Card>
        )}

        <Card className={`p-6 ${showResidentSearch ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="flex items-center gap-2 text-brand-blue mb-4">
            <ClipboardList className="w-4 h-4" />
            <h3 className="font-semibold text-brand-ink">Completed Consultations</h3>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-brand-gray">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading consultations…
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-3 rounded-2xl border border-brand-danger/30 bg-brand-danger/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-danger" />
              <div>
                <p className="text-sm font-semibold text-brand-ink">Couldn't load consultations</p>
                <p className="mt-0.5 text-xs text-brand-gray">{loadError}</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-brand-border p-8 text-center">
              <Stethoscope className="mx-auto h-8 w-8 text-brand-gray/60" />
              <p className="mt-3 text-sm font-medium text-brand-ink">No completed consultations yet</p>
              <p className="mt-1 text-xs text-brand-gray">
                Completed consultations recorded for residents in your scope will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <div key={item.id} className="border border-brand-border rounded-2xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-brand-ink">
                      {item.resident?.name || "Resident"}
                      {item.consultationDate ? ` · ${item.consultationDate}` : ""}
                    </p>
                    <span className="text-xs text-brand-green bg-brand-green/10 px-2.5 py-1 rounded-full capitalize">{item.status}</span>
                  </div>
                  <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm text-brand-gray">
                    <p className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-brand-blue" /> Reason: {item.chiefComplaint || "—"}</p>
                    <p className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-brand-blue" /> Diagnosis: {item.diagnosis || "—"}</p>
                    <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-blue" /> RHU Station: {item.facilityName || item.resident?.barangay || "—"}</p>
                    <p className="flex items-center gap-2"><User className="w-4 h-4 text-brand-blue" /> Assigned RHU Personnel: {item.attendingPersonnel?.fullName || "—"}</p>
                    {item.resident?.barangay ? (
                      <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-blue" /> Barangay: {item.resident.barangay}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
