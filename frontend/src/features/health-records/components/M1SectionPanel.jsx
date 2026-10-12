import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Pencil, Save, Search, Trash2, X } from "lucide-react";
import { Card } from "@/components/common/Card";
import { m1Api } from "@/services/api";
import { toReportParams } from "@/features/health-records/lib/reportingPeriod";

/**
 * M1 Section workspace — grouped-grid dashboard.
 *
 * One FHSIS program section (e.g. Family Planning = A, Child Care = C) rendered
 * as a COMPACT TWO-COLUMN layout of indicator-group panels (one bordered table
 * per official subsection) instead of a single long full-width table. Each
 * panel has a colored group header (chevron, code + title, indicator count and
 * a display-only subtotal) and a dense table with the columns:
 *
 *   No. | Code | Indicator | <reporting period> | Action
 *
 * LAYOUT NOTE — the two desktop columns are built as independent flex stacks
 * (NOT a 2-track CSS grid). A CSS grid aligns both cells of a row to the tallest
 * panel, which left large blank areas beneath short groups like A1/A3. Flex
 * columns let each panel keep its natural height and let the next group sit
 * directly below the previous one in the same column with only the gap between
 * them. Groups are distributed to the shorter column (by indicator count) so the
 * two columns stay balanced while preserving the official order within a column.
 *
 * The reporting value is an editable input ONLY where editing is permitted
 * (manual single-figure indicators in a monthly period); everything derived from
 * real records stays read-only. Edits persist via PUT /m1/manual — nothing is
 * recomputed here and the official M1 PDF is unaffected.
 */

// Modules that own the operational records behind a derived indicator, so the
// row can link to where the data is actually captured (NOT a details popover).
const MODULE_HINT = {
  immunizations: { label: "Open Immunization", to: "../immunization" },
  households: { label: "Open Households", to: "../households" },
};

/** A manual indicator with no age/sex breakdown is a single editable figure. */
const isSingleBucket = (ind) => (!ind.ageScheme || ind.ageScheme === "none") && !ind.sexBreakdown;

export default function M1SectionPanel({ sectionKey, sectionTitle, descriptor, periodLabel, onBack, onEditManual, navigate }) {
  const [byCode, setByCode] = useState({});
  const [mapping, setMapping] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [edits, setEdits] = useState({}); // code -> string (pending manual value)
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  const isMonthly = descriptor?.period === "monthly";

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
  // Discard pending edits whenever the reporting period changes.
  useEffect(() => { setEdits({}); setSaveNote(""); }, [descriptor]);

  // Group this section's indicators by their official FHSIS subsection (A1, A2,
  // A3 / C1, C2 …). The catalog is served in displayOrder and a Map preserves
  // first-insertion order, so the official indicator order is kept intact and
  // each group appears exactly once (no duplicated headings).
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

  const hasManual = useMemo(
    () => mapping.some((m) => m.section === sectionKey && m.source === "m1_manual"),
    [mapping, sectionKey],
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => {
        const indicators = g.indicators.filter(
          (ind) => !q || ind.name.toLowerCase().includes(q) || ind.code.toLowerCase().includes(q),
        );
        const subtotal = indicators.reduce((sum, ind) => sum + (Number(byCode[ind.code]?.total) || 0), 0);
        return { ...g, indicators, subtotal };
      })
      .filter((g) => g.indicators.length > 0);
  }, [groups, search, byCode]);

  // Distribute groups into two balanced desktop columns. Each group is placed in
  // whichever column is currently shorter (estimated by indicator count + header
  // overhead), so a short group (A1, A3) packs directly under the previous group
  // in its column instead of being pushed down to align with the tallest panel.
  // Order within a column is preserved; for Family Planning this yields A1 over
  // A3 in the left column and A2 in the right column.
  const [colLeft, colRight] = useMemo(() => {
    const left = [];
    const right = [];
    let hLeft = 0;
    let hRight = 0;
    for (const g of filteredGroups) {
      const weight = g.indicators.length + 2; // +2 ≈ header + column row
      if (hLeft <= hRight) { left.push(g); hLeft += weight; }
      else { right.push(g); hRight += weight; }
    }
    return [left, right];
  }, [filteredGroups]);

  const allCount = mapping.filter((m) => m.section === sectionKey).length;
  const visibleCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.indicators.length, 0),
    [filteredGroups],
  );
  const isFiltering = search.trim() !== "";

  // Pending manual edits that actually differ from the stored value.
  const dirtyCodes = useMemo(
    () => Object.keys(edits).filter((code) => Number(edits[code] || 0) !== Number(byCode[code]?.total ?? 0)),
    [edits, byCode],
  );

  const setEdit = (code, v) => { setEdits((p) => ({ ...p, [code]: v })); setSaveNote(""); };

  const toggleGroup = (key) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allGroupsCollapsed = filteredGroups.length > 0 && filteredGroups.every((g) => collapsedGroups.has(g.key));
  const toggleAllGroups = () =>
    setCollapsedGroups(() => (allGroupsCollapsed ? new Set() : new Set(filteredGroups.map((g) => g.key))));

  // Persist all pending manual edits for the selected month through the shared
  // manual-entry API (upsert — an edited value replaces the stored figure, no
  // duplicates). Values are reloaded afterwards so the on-screen figures and the
  // official report never diverge.
  const handleSaveChanges = async () => {
    if (saving || dirtyCodes.length === 0) return;
    const year = descriptor.year;
    const month = (descriptor.month ?? 0) + 1; // API expects 1-12
    setSaving(true);
    setError(null);
    try {
      for (const code of dirtyCodes) {
        await m1Api.saveManual({
          year,
          month,
          indicatorCode: code,
          values: [{ age_group: "Total", sex: "", value: Number(edits[code]) || 0 }],
          remarks: "",
        });
      }
      setEdits({});
      await load();
      setSaveNote(`Saved ${dirtyCodes.length} reporting figure${dirtyCodes.length === 1 ? "" : "s"} for ${periodLabel}.`);
    } catch (e) {
      setError(e?.message || "Could not save the reporting figures.");
    } finally {
      setSaving(false);
    }
  };

  const panelProps = {
    byCode, edits, setEdit, isMonthly, periodLabel, sectionKey, onEditManual, navigate,
    collapsedGroups, toggleGroup,
  };

  return (
    <div className="mt-4">
      {/* Panel header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <ArrowLeft className="h-4 w-4" /> Back to Health Services
          </button>
          <div>
            <h3 className="text-[17px] font-semibold leading-tight text-brand-ink">{sectionTitle}</h3>
            <p className="text-xs text-brand-gray">{allCount} indicators · values for {periodLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveNote && <span className="text-xs font-medium text-brand-green">{saveNote}</span>}
          <button
            onClick={handleSaveChanges}
            disabled={saving || dirtyCodes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            title={dirtyCodes.length ? `Save ${dirtyCodes.length} changed figure(s)` : "No changes to save"}
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : dirtyCodes.length ? `Save Changes (${dirtyCodes.length})` : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Toolbar: search + collapse/expand (no Source filter) */}
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
        {isFiltering && (
          <button
            onClick={() => setSearch("")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-blue hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Clear
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
        {hasManual && !isMonthly && (
          <span className="rounded-md bg-brand-light px-2 py-1 text-[11px] font-medium text-brand-blue">
            Switch to a monthly period to edit reporting figures.
          </span>
        )}
        {!loading && (
          <span className="ml-auto text-xs text-brand-gray">
            <span className="font-medium text-brand-ink">{isFiltering ? `${visibleCount} of ${allCount}` : allCount}</span> indicators
          </span>
        )}
      </div>

      {error && <Card className="mb-3 p-4 text-sm text-brand-danger">{error}</Card>}

      {loading ? (
        <Card className="p-8 text-center text-sm text-brand-gray">Loading section report…</Card>
      ) : filteredGroups.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium text-brand-ink">No indicators match the current search.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-brand-gray">Try a different search term.</p>
          {isFiltering && (
            <button
              onClick={() => setSearch("")}
              className="mt-3 inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue"
            >
              <X className="h-3.5 w-3.5" /> Clear search
            </button>
          )}
        </Card>
      ) : (
        <>
          {/* Desktop (xl+): two balanced, top-aligned flex columns. items-start on
              the row keeps the columns independent so neither stretches to match
              the other; each column packs its panels top-down with a 12px gap. */}
          <div className="hidden items-start gap-x-4 xl:flex">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {colLeft.map((g) => <GroupPanel key={g.key} g={g} {...panelProps} />)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {colRight.map((g) => <GroupPanel key={g.key} g={g} {...panelProps} />)}
            </div>
          </div>

          {/* Below xl: a single ordered column (A1 → A2 → A3 …). */}
          <div className="flex flex-col gap-3 xl:hidden">
            {filteredGroups.map((g) => <GroupPanel key={g.key} g={g} {...panelProps} />)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One indicator-group panel: colored header + compact table. Height is driven
 * purely by content (no fixed height, min-height or h-full), so short groups do
 * not reserve blank space.
 */
function GroupPanel({ g, byCode, edits, setEdit, isMonthly, periodLabel, sectionKey, onEditManual, navigate, collapsedGroups, toggleGroup }) {
  const groupCollapsed = collapsedGroups.has(g.key);
  return (
    <section className="overflow-hidden rounded-btn border border-brand-border bg-white">
      {/* Colored group header */}
      <button
        type="button"
        onClick={() => toggleGroup(g.key)}
        aria-expanded={!groupCollapsed}
        className="flex w-full items-center gap-2 border-b border-brand-border bg-brand-light px-3 py-2 text-left transition-colors hover:bg-brand-light/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
      >
        {groupCollapsed
          ? <ChevronRight className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />}
        <span className="truncate text-[13px] font-semibold text-brand-dark">{g.label}</span>
        <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-blue">
          {g.indicators.length}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-1.5 pr-0.5 text-[11px] font-medium uppercase tracking-wide text-brand-blue/80">
          Subtotal
          <span className="font-stat text-sm font-bold tabular-nums text-brand-dark">{g.subtotal}</span>
        </span>
      </button>

      {!groupCollapsed && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg/60 text-left text-[10px] uppercase tracking-wide text-brand-gray">
                <th className="w-9 px-2 py-1.5 text-center font-semibold">No.</th>
                <th className="w-20 px-2 py-1.5 font-semibold">Code</th>
                <th className="px-2 py-1.5 font-semibold">Indicator</th>
                <th className="w-24 px-2 py-1.5 text-right font-semibold">{periodLabel}</th>
                <th className="w-16 px-2 py-1.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {g.indicators.map((ind, i) => {
                const value = byCode[ind.code]?.total ?? 0;
                const manual = ind.source === "m1_manual";
                const editableInline = manual && isMonthly && isSingleBucket(ind);
                const inputVal = edits[ind.code] !== undefined ? edits[ind.code] : String(value);
                const hint = MODULE_HINT[ind.source];
                return (
                  <tr
                    key={ind.code}
                    className="border-b border-brand-border/50 last:border-0 odd:bg-white even:bg-brand-bg/20 hover:bg-brand-bg/40"
                  >
                    <td className="px-2 py-1 text-center tabular-nums text-brand-gray">{i + 1}</td>
                    <td className="px-2 py-1 font-mono text-[11px] text-brand-gray">{ind.code}</td>
                    <td className="px-2 py-1 leading-snug text-brand-ink">{ind.name}</td>
                    <td className="px-2 py-1 text-right align-middle">
                      {editableInline ? (
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={inputVal}
                          onChange={(e) => setEdit(ind.code, e.target.value)}
                          aria-label={`${ind.name} value for ${periodLabel}`}
                          className="w-16 rounded border border-brand-border bg-white px-1.5 py-0.5 text-right font-stat text-[13px] font-bold tabular-nums text-brand-ink outline-none focus:border-brand-blue"
                        />
                      ) : (
                        <span className="font-stat text-sm font-bold tabular-nums text-brand-ink">{value}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        {editableInline ? (
                          <button
                            onClick={() => setEdit(ind.code, "0")}
                            className="inline-flex items-center text-brand-gray hover:text-brand-danger"
                            title="Clear this reporting figure (saved on Save Changes)"
                            aria-label={`Clear ${ind.code}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : manual ? (
                          <button
                            onClick={() => onEditManual(sectionKey)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                            title="Edit reporting figure"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                        ) : hint?.to ? (
                          <button
                            onClick={() => navigate(hint.to)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                            title={hint.label}
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Open
                          </button>
                        ) : (
                          <span className="text-[11px] text-brand-gray/70" title="Calculated automatically from records">Auto</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
