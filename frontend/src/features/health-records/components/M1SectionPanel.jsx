import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { Card } from "@/components/common/Card";
import { m1Api } from "@/services/api";
import { toReportParams } from "@/features/health-records/lib/reportingPeriod";

/**
 * M1 Section workspace panel.
 *
 * Shows one FHSIS M1 program section as a REPORTING/CONSOLIDATION view: every
 * indicator in the section with its authoritative data source (from the
 * centralized source mapping) and its LIVE value for the selected reporting
 * period (from the shared aggregation engine, GET /m1/report → byCode). Nothing
 * is recomputed here — the same engine that drives the on-screen summary and the
 * PDF produces these numbers.
 *
 * - Operationally-derived indicators (maternal_records, immunizations,
 *   households, mortality, FP events) are READ-ONLY here and show where the
 *   underlying service is recorded. Editing happens in that operational module,
 *   never by typing an M1 total (prevents double counting).
 * - Manual-reporting indicators (m1_manual) expose an Edit action that opens the
 *   section's M1 data-entry form — the only legitimate input for figures that
 *   have no operational source.
 */

const MODULE_HINT = {
  immunizations: { label: "Recorded in Immunization", to: "../immunization" },
  households: { label: "Recorded in Households", to: "../households" },
  maternal_records: { label: "Recorded in Maternal Care", to: null },
  household_member_health_profiles: { label: "From member mortality records", to: null },
  m1_records: { label: "Family planning service events", to: null },
};

export default function M1SectionPanel({ sectionKey, sectionTitle, descriptor, periodLabel, onBack, onEditManual, navigate }) {
  const [byCode, setByCode] = useState({});
  const [mapping, setMapping] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    return Promise.all([m1Api.report(toReportParams(descriptor)), m1Api.catalog()])
      .then(([report, catalog]) => {
        setByCode(report?.byCode || {});
        setMapping(catalog?.sourceMapping || []);
      })
      .catch((e) => setError(e?.message || "Could not load the section report."))
      .finally(() => setLoading(false));
  }, [descriptor]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const items = mapping.filter((m) => m.section === sectionKey);
    const bySub = new Map();
    for (const it of items) {
      if (!bySub.has(it.subsection)) bySub.set(it.subsection, []);
      bySub.get(it.subsection).push(it);
    }
    return [...bySub.entries()].map(([subsection, indicators]) => ({ subsection, indicators }));
  }, [mapping, sectionKey]);

  const manualCount = useMemo(
    () => mapping.filter((m) => m.section === sectionKey && m.source === "m1_manual").length,
    [mapping, sectionKey],
  );

  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <ArrowLeft className="h-4 w-4" /> Health Services
          </button>
          <div>
            <h3 className="font-semibold text-brand-ink">{sectionTitle}</h3>
            <p className="text-xs text-brand-gray">FHSIS M1 indicators for {periodLabel} — values computed from the recorded operational data.</p>
          </div>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-gray hover:text-brand-ink" title="Reload values">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error && <Card className="p-6 text-sm text-brand-danger">{error}</Card>}

      {loading ? (
        <Card className="p-10 text-center text-sm text-brand-gray">Loading section report…</Card>
      ) : (
        <>
          {manualCount > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-btn border border-brand-border bg-brand-bg/40 px-4 py-3">
              <p className="text-xs text-brand-gray">
                {manualCount} indicator{manualCount === 1 ? "" : "s"} in this section have no operational record and are entered as monthly reporting figures.
              </p>
              <button
                onClick={() => onEditManual(sectionKey)}
                className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <Pencil className="h-4 w-4" /> Record Reporting Figures
              </button>
            </div>
          )}

          {groups.map((g) => (
            <Card key={g.subsection} className="mb-4 overflow-hidden">
              <div className="border-b border-brand-border bg-brand-bg/50 px-5 py-3">
                <h4 className="text-sm font-semibold text-brand-ink">{g.subsection}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-border text-left">
                      <th className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-brand-gray">Indicator</th>
                      <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-brand-gray">Data source</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-brand-gray">{periodLabel}</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-brand-gray">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.indicators.map((ind) => {
                      const value = byCode[ind.code]?.total ?? 0;
                      const manual = ind.source === "m1_manual";
                      const hint = MODULE_HINT[ind.source];
                      return (
                        <tr key={ind.code} className="border-b border-brand-border last:border-0">
                          <td className="px-5 py-2.5">
                            <p className="font-medium text-brand-ink">{ind.name}</p>
                            <p className="text-[11px] text-brand-gray">{ind.code}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-brand-gray">
                            {manual ? "Monthly reporting figure" : (hint?.label || ind.sourceLabel)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-stat font-bold text-brand-ink">{value}</td>
                          <td className="px-5 py-2.5 text-right">
                            {manual ? (
                              <button onClick={() => onEditManual(sectionKey)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </button>
                            ) : hint?.to ? (
                              <button onClick={() => navigate(hint.to)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                                <ExternalLink className="h-3.5 w-3.5" /> Open
                              </button>
                            ) : (
                              <span className="text-xs text-brand-gray">Derived</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
