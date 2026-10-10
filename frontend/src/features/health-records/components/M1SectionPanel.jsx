import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Pencil, RefreshCw, Search, X } from "lucide-react";
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

export default function M1SectionPanel({ sectionKey, sectionTitle, descriptor, periodLabel, onBack, onEditManual, navigate }) {
  const [byCode, setByCode] = useState({});
  const [mapping, setMapping] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All"); // All | Derived | Manual
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set()); // subsection keys collapsed by the user

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

  // Group the section's indicators by their official FHSIS subsection (A1, A2,
  // C1 …) so the on-screen structure mirrors the printed M1 form. The catalog is
  // served in displayOrder, and a Map preserves first-insertion order, so the
  // official indicator order is kept intact. Derived vs manual stays visible per
  // row via the Status badge, so no information is lost by grouping on subsection.
  const groups = useMemo(() => {
    const items = mapping.filter((m) => m.section === sectionKey);
    const bySub = new Map();
    for (const it of items) {
      const key = it.subsection || "Other indicators";
      if (!bySub.has(key)) bySub.set(key, []);
      bySub.get(key).push(it);
    }
    return [...bySub.entries()].map(([key, indicators]) => ({ key, label: key, indicators }));
  }, [mapping, sectionKey]);

  const manualCount = useMemo(
    () => mapping.filter((m) => m.section === sectionKey && m.source === "m1_manual").length,
    [mapping, sectionKey],
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => {
        const indicators = g.indicators.filter((ind) => {
          if (q && !ind.name.toLowerCase().includes(q) && !ind.code.toLowerCase().includes(q)) return false;
          if (statusFilter === "Derived" && ind.source === "m1_manual") return false;
          if (statusFilter === "Manual" && ind.source !== "m1_manual") return false;
          return true;
        });
        // Subsection subtotal — a plain sum of the already-aggregated indicator
        // totals for the group (display only; nothing is recomputed here).
        const subtotal = indicators.reduce((sum, ind) => sum + (Number(byCode[ind.code]?.total) || 0), 0);
        return { ...g, indicators, subtotal };
      })
      .filter((g) => g.indicators.length > 0);
  }, [groups, search, statusFilter, byCode]);

  const allCount = mapping.filter((m) => m.section === sectionKey).length;
  const visibleCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.indicators.length, 0),
    [filteredGroups],
  );
  const isFiltering = search.trim() !== "" || statusFilter !== "All";

  const resetFilters = () => { setSearch(""); setStatusFilter("All"); };

  const toggleExpand = (code) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  const toggleGroup = (key) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allGroupsCollapsed = filteredGroups.length > 0 && filteredGroups.every((g) => collapsedGroups.has(g.key));
  const toggleAllGroups = () =>
    setCollapsedGroups(() => (allGroupsCollapsed ? new Set() : new Set(filteredGroups.map((g) => g.key))));

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
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
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
        {isFiltering && (
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-blue hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
        {!loading && filteredGroups.length > 0 && (
          <button
            onClick={toggleAllGroups}
            className="inline-flex items-center gap-1 rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs font-medium text-brand-gray hover:text-brand-ink"
          >
            {allGroupsCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {allGroupsCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        {!loading && (
          <span className="ml-auto text-xs text-brand-gray">
            <span className="font-medium text-brand-ink">
              {isFiltering ? `${visibleCount} of ${allCount}` : allCount}
            </span> indicators
          </span>
        )}
      </div>

      {error && <Card className="p-5 text-sm text-brand-danger">{error}</Card>}

      {loading ? (
        <Card className="p-8 text-center text-sm text-brand-gray">Loading section report…</Card>
      ) : (
        <div className="overflow-hidden rounded-btn border border-brand-border">
          {/* Single scroll container (both axes) so the column headers can stay
              pinned while scrolling long sections. */}
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-brand-border bg-brand-bg text-left">
                  <th className="border-b border-brand-border bg-brand-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Indicator</th>
                  <th className="w-24 border-b border-brand-border bg-brand-bg px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">{periodLabel}</th>
                  <th className="w-24 border-b border-brand-border bg-brand-bg px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-brand-gray" title="DERIVED = calculated automatically from real records. MANUAL = entered as a monthly reporting figure.">Source</th>
                  <th className="w-28 border-b border-brand-border bg-brand-bg px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filteredGroups.map((g) => {
                  const groupCollapsed = collapsedGroups.has(g.key);
                  return (
                  <React.Fragment key={g.key}>
                    {/* Collapsible subsection header — official M1 subsection name,
                        indicator count and a display-only subtotal. */}
                    <tr className="bg-brand-bg/40">
                      <td colSpan={4} className="p-0">
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.key)}
                          aria-expanded={!groupCollapsed}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
                        >
                          {groupCollapsed
                            ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-hidden="true" />
                            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-hidden="true" />}
                          <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{g.label}</span>
                          <span className="rounded-full bg-brand-border/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-gray">
                            {g.indicators.length}
                          </span>
                          <span className="ml-auto flex items-baseline gap-1.5 pr-1 text-[11px] font-medium uppercase tracking-wide text-brand-gray">
                            Subtotal
                            <span className="font-stat text-sm font-bold tabular-nums text-brand-ink">{g.subtotal}</span>
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!groupCollapsed && g.indicators.map((ind) => {
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
                            <td className="px-3 py-2 text-right align-middle font-stat text-base font-bold tabular-nums text-brand-ink">{value}</td>
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
                  );
                })}
                {filteredGroups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center">
                      <p className="text-sm font-medium text-brand-ink">No indicators match the current filter.</p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-brand-gray">
                        Try a different search term or source filter.
                      </p>
                      {isFiltering && (
                        <button
                          onClick={resetFilters}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue"
                        >
                          <X className="h-3.5 w-3.5" /> Reset filters
                        </button>
                      )}
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