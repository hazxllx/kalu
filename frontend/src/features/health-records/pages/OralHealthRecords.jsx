import React, { useCallback, useEffect, useState } from "react";
import ProgramFormPage from "../components/ProgramFormPage";
import TclPageHeader from "../components/TclPageHeader";
import { Card } from "@/components/common/Card";
import { RefreshCw, Download } from "lucide-react";
import { oralHealthApi } from "@/services/api";
import { PROGRAM_FORMS } from "../lib/programFormConfig";
import { buildOralStatisticsCsv, downloadCsv } from "../lib/programFormExport";

const inputCls = "mt-1.5 w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue";

function Statistics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [population, setPopulation] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (population) params.population = population;
    return oralHealthApi.statistics(params)
      .then((res) => setData(res?.statistics || null))
      .catch((e) => setError(e?.message || "Could not load statistics."))
      .finally(() => setLoading(false));
  }, [from, to, population]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div><label className="text-sm font-medium text-brand-ink">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></div>
          <div><label className="text-sm font-medium text-brand-ink">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></div>
          <div><label className="text-sm font-medium text-brand-ink">Total Population (optional)</label><input type="number" value={population} onChange={(e) => setPopulation(e.target.value)} placeholder="for targets" className={inputCls} /></div>
          <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark transition-colors"><RefreshCw className="h-4 w-4" /> Recompute</button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-brand-gray">
            Counts are computed from saved Oral Health TCL records for the selected period. Population-based targets are only
            shown when a total population is supplied; they are never fabricated.
          </p>
          <button
            disabled={!data}
            onClick={() => data && downloadCsv(`oral-health-ST-${new Date().toISOString().slice(0, 10)}.csv`, buildOralStatisticsCsv(data))}
            className="shrink-0 inline-flex items-center gap-2 border border-brand-border text-brand-ink px-3 py-2 rounded-btn text-sm font-medium hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </Card>

      {error ? (
        <Card className="p-8 text-center"><p className="text-sm font-medium text-brand-danger">{error}</p></Card>
      ) : loading || !data ? (
        <p className="py-8 text-center text-sm text-brand-gray">Loading statistics…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Indicator</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center">NHTS</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center">Non-NHTS</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center">Total</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Target basis</th>
                <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide text-center">Target</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-2.5 text-brand-ink">{data.indicator_1_orally_fit_12_59.label}</td>
                <td className="px-4 py-2.5 text-center">{data.indicator_1_orally_fit_12_59.counts.nhts}</td>
                <td className="px-4 py-2.5 text-center">{data.indicator_1_orally_fit_12_59.counts.non_nhts}</td>
                <td className="px-4 py-2.5 text-center font-semibold">{data.indicator_1_orally_fit_12_59.counts.total}</td>
                <td className="px-4 py-2.5 text-xs text-brand-gray" colSpan={2}>Total population X 8.658% X 20%</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-4 py-2.5 text-brand-ink">{data.indicator_2_dmft_new.label}</td>
                <td className="px-4 py-2.5 text-center">{data.indicator_2_dmft_new.counts.nhts}</td>
                <td className="px-4 py-2.5 text-center">{data.indicator_2_dmft_new.counts.non_nhts}</td>
                <td className="px-4 py-2.5 text-center font-semibold">{data.indicator_2_dmft_new.counts.total}</td>
                <td className="px-4 py-2.5 text-xs text-brand-gray" colSpan={2}>Total no. of 5 y/o and above examined</td>
              </tr>
              {Object.entries(data.bohc).map(([key, def]) => (
                <tr key={key} className="border-t border-slate-200">
                  <td className="px-4 py-2.5 text-brand-ink">{def.label}</td>
                  <td className="px-4 py-2.5 text-center">{def.counts.nhts}</td>
                  <td className="px-4 py-2.5 text-center">{def.counts.non_nhts}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{def.counts.total}</td>
                  <td className="px-4 py-2.5 text-xs text-brand-gray">{def.target_basis}</td>
                  <td className="px-4 py-2.5 text-center">{def.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * Oral Health module: the client-level Target Client List (TCL) and the
 * statistical (ST) BOHC indicator table computed from those records.
 */
export default function OralHealthRecords() {
  const [tab, setTab] = useState("tcl");
  return (
    <>
      <TclPageHeader
        crumb="Oral Health"
        title="Oral Health Care & Services"
        subtitle="Client-level Target Client List and the Basic Oral Health Care (BOHC) statistical table."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setTab("tcl")} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === "tcl" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-brand-gray border-brand-border hover:border-brand-blue"}`}>Target Client List</button>
        <button onClick={() => setTab("st")} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === "st" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-brand-gray border-brand-border hover:border-brand-blue"}`}>Statistical Table (ST)</button>
      </div>
      {tab === "tcl" ? <ProgramFormPage config={PROGRAM_FORMS["oral-health"]} /> : <Statistics />}
    </>
  );
}
