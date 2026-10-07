import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Pencil, RefreshCw, Search } from "lucide-react";
import { Card } from "@/components/common/Card";
import { m1Api } from "@/services/api";
import { toReportParams } from "@/features/health-records/lib/reportingPeriod";

/**
 * M1 Section workspace panel.
 *
 * High-density reporting view of ONE FHSIS program section:
 *
 *  - a single compact table (not one card per subsection),
 *  - the data source is printed ONCE per source group, not repeated on every
 *    indicator row,
 *  - every row carries a compact DERIVED / MANUAL status badge,
 *  - age-banded indicators show only the total; the full 10-14 / 15-19 /
 *    20-49 / Total breakdown expands via a Details toggle,
 *  - a toolbar with search + Derived/Manual filtering keeps large sections
 *    scannable without hiding any indicator.
 *
 * Values come straight from the shared aggregation engine (GET /m1/report →
 * byCode); NOTHING is recomputed here. The official M1 PDF is unaffected.
 */

const MODULE_HINT = {
  immunizations: { label: "Recorded in Immunization", to: "../immunization" },
  households: { label: "Recorded in Households", to: "../households" },
  maternal_records: { label: "Recorded in Maternal Care", to: null },
  household_member_health_profiles: { label: "From member mortality records", to: null },
  m1_records: { label: "Family planning service events", to: null },
};

const SOURCE_LABEL = {
  m1_manual: "Monthly reporting figure",
};

export default function M1SectionPanel({ sectionKey, sectionTitle, descriptor, periodLabel, onBack, onEditManual, navigate }) {
  const [byCode, setByCode] = useState({});
  const [mapping, setMapping] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All"); // All | Derived | Manual
  const [expanded, setExpanded] = useState(() => new Set());

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

  // Group the section's indicators by source so the source label is shown ONCE
  // per group instead of on every row.
  const itSourceLabel = (source, items) => {
    const first = items.find((i) => i.source === source);
    return first?.sourceLabel || source;
  };
  const groups = useMemo(() => {
    const items = mapping.filter((m) => m.section === sectionKey);
    const bySource = new Map();
    for (const it of items) {
      const key = it.source || "unknown";
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(it);
    }
    const sourceOrder = [...bySource.keys()].sort((a, b) => {
      const manual = (k) => (k === "m1_manual" ? 1 : 0);
      return manual(a) - manual(b);
    });
    return sourceOrder.map((source) => ({
      source,
      sourceLabel: SOURCE_LABEL[source] || MODULE_HINT[source]?.label || itSourceLabel(source, items),
      indicators: bySource.get(source),
    }));
  }, [mapping, sectionKey]);

  const manualCount = useMemo(
    () => mapping.filter((m) => m.section === sectionKey && m.source === "m1_manual").length,
    [mapping, sectionKey],
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        indicators: g.indicators.filter((ind) => {
          if (q && !ind.name.toLowerCase().includes(q) && !ind.code.toLowerCase().includes(q)) return false;
          if (statusFilter === "Derived" && ind.source === "m1_manual") return false;
          if (statusFilter === "Manual" && ind.source !== "m1_manual") return false;
          return true;
        }),
      }))
      .filter((g) => g.indicators.length > 0);
  }, [groups, search, statusFilter]);

  const allCount = mapping.filter((m) => m.section === sectionKey).length;

  const toggleExpand = (code) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <div className="mt-6">
      {/* Panel header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <ArrowLeft className="h-4 w-4" /> Health Services
          </button>
          <div>
            <h3 className="text-[17px] font-semibold leading-tight text-brand-ink">{sectionTitle}</h3>
            <p className="text-xs text-brand-gray">{allCount} indicators · values for {periodLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {manualCount > 0 && (
            <button
              onClick={() => onEditManual(sectionKey)}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <Pencil className="h-3.5 w-3.5" /> Record Reporting Figures
            </button>
          )}
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-gray hover:text-brand-ink" title="Reload values">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Toolbar: search + Derived/Manual filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-brand-gray" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search indicators…"
            aria-label="Search indicators"
            className="w-56 rounded-md border border-brand-border bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-blue"
          />
        </div>
        <div className="inline-flex rounded-md border border-brand-border bg-white p-0.5 text-sm">
          {["All", "Derived", "Manual"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              aria-pressed={statusFilter === f}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === f ? "bg-brand-blue text-white" : "text-brand-gray hover:text-brand-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-brand-gray">
          DERIVED = calculated automatically from real records · MANUAL = entered as a reporting figure
        </span>
      </div>

      {error && <Card className="p-5 text-sm text-brand-danger">{error}</Card>}

      {loading ? (
        <Card className="p-8 text-center text-sm text-brand-gray">Loading section report…</Card>
      ) : (
        <div className="overflow-hidden rounded-btn border border-brand-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg/50 text-left">
                  <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Indicator</th>
                  <th className="w-24 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">{periodLabel}</th>
                  <th className="w-24 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Status</th>
                  <th className="w-28 px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filteredGroups.map((g) => (
                  <React.Fragment key={g.source}>
                    {/* Source group header — shown once per source, not per row */}
                    <tr className="bg-brand-bg/30">
                      <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                        {g.sourceLabel}
                      </td>
                    </tr>
                    {g.indicators.map((ind) => {
                      const value = byCode[ind.code]?.total ?? 0;
                      const byAge = byCode[ind.code]?.byAge;
                      const ageGroups = byCode[ind.code]?.ageGroups || (ind.ageScheme && ind.ageScheme !== "none" ? (ind.ageGroups || []) : null);
                      const hasBreakdown = Boolean(
                        byAge && Object.keys(byAge).length > 1
                        || (ageGroups && ageGroups.length > 1)
                        || (byCode[ind.code]?.bySex && Object.keys(byCode[ind.code].bySex).length > 0),
                      );
                      const manual = ind.source === "m1_manual";
                      const hint = MODULE_HINT[ind.source];
                      const isOpen = expanded.has(ind.code);
                      return (
                        <React.Fragment key={ind.code}>
                          <tr className="hover:bg-brand-bg/30">
                            <td className="px-4 py-2">
                              <p className="font-medium leading-snug text-brand-ink">{ind.name}</p>
                              <p className="text-[11px] text-brand-gray">{ind.code}</p>
                            </td>
                            <td className="px-3 py-2 text-right align-middle font-stat text-base font-bold text-brand-ink">{value}</td>
                            <td className="px-3 py-2 text-center align-middle">
                              {manual ? (
                                <span className="inline-flex rounded-full bg-brand-yellow/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#B07E00]">Manual</span>
                              ) : (
                                <span className="inline-flex rounded-full bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-green">Derived</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right align-middle">
                              <div className="flex items-center justify-end gap-2">
                                {hasBreakdown ? (
                                  <button
                                    onClick={() => toggleExpand(ind.code)}
                                    aria-expanded={isOpen}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                                  >
                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    {isOpen ? "Hide details" : "Details"}
                                  </button>
                                ) : manual ? (
                                  <button onClick={() => onEditManual(sectionKey)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline" title="Edit reporting figure">
                                    <Pencil className="h-3.5 w-3.5" /> Edit
                                  </button>
                                ) : hint?.to ? (
                                  <button onClick={() => navigate(hint.to)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline" title={hint.label}>
                                    <ExternalLink className="h-3.5 w-3.5" /> Open
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-brand-bg/20">
                              <td colSpan={4} className="px-4 pb-3 pt-1">
                                <AgeBreakdown value={byCode[ind.code]} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
                {filteredGroups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-brand-gray">
                      No indicators match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible age/sex breakdown for one indicator. */
function AgeBreakdown({ value = {} }) {
  const { byAge, bySex, total } = value;
  const ageKeys = byAge ? Object.keys(byAge) : [];
  const sexKeys = bySex ? Object.keys(bySex) : [];
  if (!ageKeys.length && !sexKeys.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-brand-gray">
      {ageKeys.map((k) => (
        <span key={k} className="inline-flex items-baseline gap-1.5">
          <span className="font-medium text-brand-gray">{k}</span>
          <span className="font-stat text-sm font-bold text-brand-ink">{byAge[k] ?? 0}</span>
        </span>
      ))}
      {ageKeys.length > 0 && total != null && (
        <span className="inline-flex items-baseline gap-1.5 border-l border-brand-border pl-3">
          <span className="font-medium text-brand-gray">Total</span>
          <span className="font-stat text-sm font-bold text-brand-ink">{total}</span>
        </span>
      )}
      {sexKeys.map((k) => (
        <span key={k} className="inline-flex items-baseline gap-1.5">
          <span className="font-medium text-brand-gray">{k}</span>
          <span className="font-stat text-sm font-bold text-brand-ink">{bySex[k] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}