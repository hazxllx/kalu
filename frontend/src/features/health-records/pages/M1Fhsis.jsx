import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import {
  Plus, X, Search, Printer, ChevronRight, ChevronDown, ChevronLeft, AlertCircle,
} from "lucide-react";
import { m1Api, residentsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";

/**
 * FHSIS M1 — complete monthly service-coverage report.
 *
 * This is the READABLE digital interface over the M1 data (NOT a copy of the
 * paper form). Every total shown is computed by the backend from underlying
 * records and is clickable to reveal exactly which residents/records produced
 * it (drill-down). The separate print view renders the compact, official-style
 * M1 form. The report barangay is resolved automatically from the authenticated
 * user's scope; a barangay-scoped user can never widen it.
 */

const SECTION_TITLES = {
  A: "Family Planning Services",
  B: "Maternal Care and Services",
  C: "Child Care and Services",
  D: "Oral Care and Services",
  E: "Infectious Disease Prevention & Control",
  F: "Non-Communicable Disease Prevention & Control",
  G: "Environmental Health and Sanitation",
  H: "Mortality and Natality",
};
const SECTION_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fullName = (r) =>
  r ? [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ") : "";

const todayStr = () => new Date().toISOString().slice(0, 10);
const shiftDate = (d, days) => {
  const dt = new Date(`${d}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Group a flat indicator array into ordered sections -> subsections.
// ---------------------------------------------------------------------------
const groupBySection = (indicators = []) => {
  const map = new Map();
  for (const it of indicators) {
    if (!map.has(it.section)) map.set(it.section, new Map());
    const subs = map.get(it.section);
    if (!subs.has(it.subsection)) subs.set(it.subsection, []);
    subs.get(it.subsection).push(it);
  }
  return SECTION_ORDER.filter((s) => map.has(s)).map((s) => ({
    section: s,
    title: SECTION_TITLES[s] || s,
    subsections: [...map.get(s).entries()].map(([subsection, items]) => ({ subsection, items })),
  }));
};

export default function M1Fhsis() {
  const { user } = useAuth();
  const supervisor = isHealthSupervisor(user);
  const scope = supervisor ? getSupervisorScope(user) : null;
  const assignedBarangay = scope && scope.level === "barangay" ? scope.assignedBarangay : (user?.barangay || null);

  const now = new Date();
  const [tab, setTab] = useState("monthly"); // daily | monthly | annual | print
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [date, setDate] = useState(todayStr());

  const [catalog, setCatalog] = useState(null);
  const [residents, setResidents] = useState([]);

  const [monthly, setMonthly] = useState(null);
  const [annual, setAnnual] = useState(null);
  const [daily, setDaily] = useState(null);
  const [meta, setMeta] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(["A", "B"]));

  const [drill, setDrill] = useState(null); // { code, name } for drilldown modal
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const [recordOpen, setRecordOpen] = useState(false);
  const [search, setSearch] = useState("");

  // -- initial reference data ------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cat, res] = await Promise.all([
          m1Api.catalog(),
          residentsApi.list({ limit: 300 }).catch(() => ({ rows: [] })),
        ]);
        if (!alive) return;
        setCatalog(cat);
        const rows = (res?.rows || res || []).map((r) => ({
          id: r.id,
          name: fullName(r) || r.name || r.id,
          barangay: r.barangay,
          age: r.birth_date ? Math.floor((Date.now() - new Date(r.birth_date)) / 31557600000) : undefined,
          sex: r.sex,
          birth_date: r.birth_date,
        }));
        setResidents(assignedBarangay ? rows.filter((r) => !r.barangay || r.barangay === assignedBarangay) : rows);
      } catch (e) {
        if (alive) setError(e?.message || "Failed to load M1 catalog.");
      }
    })();
    return () => { alive = false; };
  }, [assignedBarangay]);

  // -- period / tab data -----------------------------------------------------
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "monthly" || tab === "print") {
        const [m, mt] = await Promise.all([
          m1Api.monthly({ year, month }),
          m1Api.getMeta({ year, month }).catch(() => null),
        ]);
        setMonthly(m);
        setMeta(mt);
      } else if (tab === "annual") {
        setAnnual(await m1Api.annual({ year }));
      } else if (tab === "daily") {
        setDaily(await m1Api.daily({ date }));
      }
    } catch (e) {
      setError(e?.message || "Failed to load M1 data.");
    } finally {
      setLoading(false);
    }
  }, [tab, year, month, date]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const openDrill = async (ind) => {
    setDrill({ code: ind.code, name: ind.name });
    setDrillLoading(true);
    setDrillData(null);
    try {
      setDrillData(await m1Api.drilldown(ind.code, { year, month: tab === "annual" ? undefined : month }));
    } catch (e) {
      setDrillData({ error: e?.message || "Failed to load records." });
    } finally {
      setDrillLoading(false);
    }
  };

  const monthlyGroups = useMemo(
    () => groupBySection(monthly?.indicators || []),
    [monthly],
  );
  const annualGroups = useMemo(
    () => groupBySection(annual?.indicators || []),
    [annual],
  );

  const summary = useMemo(() => {
    if (!monthly) return { participants: 0, fp: 0, maternal: 0, child: 0 };
    const by = monthly.byCode || {};
    const sum = (codes) => codes.reduce((s, c) => s + (by[c]?.total || 0), 0);
    const sectionSum = (sec) =>
      (monthly.indicators || []).filter((i) => i.section === sec).reduce((s, i) => s + (i.total || 0), 0);
    return {
      participants: (monthly.indicators || []).reduce((s, i) => s + (i.total || 0), 0),
      fp: sectionSum("A"),
      maternal: sectionSum("B"),
      child: sectionSum("C"),
    };
  }, [monthly]);

  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  return (
    <div className="pb-16">
      <PageHeader
        crumbs={["Monitoring", "M1 / FHSIS Report"]}
        title="M1 / Maternal & Family Health Report"
        subtitle={`FHSIS M1 monthly service-coverage report${assignedBarangay ? ` — Barangay ${assignedBarangay}` : ""}`}
        meta={
          <span className="rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-semibold text-brand-blue">
            {tab === "annual" ? `Year ${year}` : tab === "daily" ? date : periodLabel}
          </span>
        }
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setRecordOpen(true)}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue/90"
            >
              <Plus className="h-4 w-4" /> Record M1 Activity
            </button>
            <button
              onClick={() => { setTab("print"); setTimeout(() => window.print(), 400); }}
              className="inline-flex items-center gap-2 rounded-btn border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" /> Print M1 Report
            </button>
          </div>
        }
      />

      {/* Controls */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-btn border border-slate-200 bg-white p-1">
          {["daily", "monthly", "annual", "print"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${
                tab === t ? "bg-brand-blue text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "daily" ? (
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setDate((d) => shiftDate(d, -1))} className="rounded-md border border-slate-200 p-2 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
            <button onClick={() => setDate((d) => shiftDate(d, 1))} className="rounded-md border border-slate-200 p-2 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setDate(todayStr())} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Today</button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2">
            {tab !== "annual" && (
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            )}
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">
              {Array.from({ length: 6 }, (_, i) => now.getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="no-print mb-6 flex items-center gap-2 rounded-lg border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm text-brand-danger">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Summary cards (monthly) */}
      {tab === "monthly" && (
        <div className="no-print mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon="Activity" tone="blue" index={0} label="Total M1 Services (month)" value={loading ? "…" : summary.participants} />
          <StatCard icon="HeartPulse" tone="accent" index={1} label="Family Planning" value={loading ? "…" : summary.fp} />
          <StatCard icon="Baby" tone="green" index={2} label="Maternal Care" value={loading ? "…" : summary.maternal} />
          <StatCard icon="Users" tone="yellow" index={3} label="Child Care" value={loading ? "…" : summary.child} />
        </div>
      )}

      {/* Body */}
      {loading ? (
        <Card className="p-10 text-center text-sm text-slate-500">Loading M1 data…</Card>
      ) : tab === "daily" ? (
        <DailyView daily={daily} search={search} setSearch={setSearch} date={date} />
      ) : tab === "monthly" ? (
        <MonthlyView groups={monthlyGroups} byCode={monthly?.byCode || {}} expanded={expanded} toggle={toggle} openDrill={openDrill} />
      ) : tab === "annual" ? (
        <AnnualView groups={annualGroups} expanded={expanded} toggle={toggle} openDrill={openDrill} year={year} />
      ) : (
        <PrintReport monthly={monthly} groups={monthlyGroups} meta={meta} periodLabel={periodLabel} barangay={assignedBarangay} />
      )}

      {drill && (
        <DrilldownModal
          drill={drill}
          data={drillData}
          loading={drillLoading}
          onClose={() => { setDrill(null); setDrillData(null); }}
        />
      )}

      {recordOpen && catalog && (
        <RecordModal
          catalog={catalog}
          residents={residents}
          onClose={() => setRecordOpen(false)}
          onSaved={() => { setRecordOpen(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily participants
// ---------------------------------------------------------------------------
function DailyView({ daily, search, setSearch, date }) {
  const rows = (daily?.participants || []).filter((p) => {
    if (!search) return true;
    const n = fullName(p.resident).toLowerCase();
    return n.includes(search.toLowerCase()) || (p.indicator || "").toLowerCase().includes(search.toLowerCase());
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h3 className="font-semibold text-slate-900">M1 Activity for {date}</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident / indicator" className="rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm" />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500">No M1 activity recorded for {date}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Resident</th>
                <th className="px-5 py-3">Section</th>
                <th className="px-5 py-3">Indicator / Service</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={`${p.source}-${p.id}`} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{fullName(p.resident) || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{p.subsection || p.section}</td>
                  <td className="px-5 py-3 text-slate-700">{p.indicator}</td>
                  <td className="px-5 py-3"><span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-semibold text-brand-green">{p.status}</span></td>
                  <td className="px-5 py-3 text-xs text-slate-400">{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Monthly — expandable sections
// ---------------------------------------------------------------------------
function MonthlyView({ groups, expanded, toggle, openDrill }) {
  if (!groups.length) return <Card className="p-10 text-center text-sm text-slate-500">No indicators.</Card>;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card key={g.section} className="overflow-hidden">
          <button onClick={() => toggle(g.section)} className="flex w-full items-center justify-between bg-brand-blue px-5 py-3 text-left text-white">
            <span className="font-semibold">SECTION {g.section} — {g.title}</span>
            {expanded.has(g.section) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
          {expanded.has(g.section) && (
            <div className="divide-y divide-slate-100">
              {g.subsections.map((sub) => (
                <div key={sub.subsection} className="px-5 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{sub.subsection}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-50">
                        {sub.items.map((it) => (
                          <tr key={it.code} className="hover:bg-slate-50">
                            <td className="py-2 pr-3 text-slate-700">{it.name}</td>
                            <td className="w-40 py-2 text-right text-xs text-slate-500">
                              {it.sexBreakdown && it.bySex ? (
                                <span>M {it.bySex.Male} · F {it.bySex.Female}</span>
                              ) : it.ageGroups?.length > 1 ? (
                                <span>{it.ageGroups.map((a) => `${a}:${it.byAge?.[a] ?? 0}`).join(" · ")}</span>
                              ) : null}
                            </td>
                            <td className="w-20 py-2 text-right">
                              <button
                                onClick={() => openDrill(it)}
                                className="rounded-md px-2 py-1 font-stat text-base font-bold text-brand-blue hover:bg-brand-blue/10"
                                title="View underlying records"
                              >
                                {it.total}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Annual — month matrix per section
// ---------------------------------------------------------------------------
function AnnualView({ groups, expanded, toggle, openDrill, year }) {
  if (!groups.length) return <Card className="p-10 text-center text-sm text-slate-500">No indicators.</Card>;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card key={g.section} className="overflow-hidden">
          <button onClick={() => toggle(g.section)} className="flex w-full items-center justify-between bg-brand-blue px-5 py-3 text-left text-white">
            <span className="font-semibold">SECTION {g.section} — {g.title}</span>
            {expanded.has(g.section) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
          {expanded.has(g.section) && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left">Indicator ({year})</th>
                    {MONTHS.map((m) => <th key={m} className="px-2 py-2 text-right">{m.slice(0, 3)}</th>)}
                    <th className="px-3 py-2 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {g.subsections.flatMap((sub) => sub.items).map((it) => (
                    <tr key={it.code} className="hover:bg-slate-50">
                      <td className="sticky left-0 bg-white px-3 py-2 text-left text-slate-700">{it.name}</td>
                      {it.months.map((v, i) => <td key={i} className="px-2 py-2 text-right text-slate-600">{v || ""}</td>)}
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openDrill(it)} className="font-stat font-bold text-brand-blue hover:underline">{it.annual}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-down modal
// ---------------------------------------------------------------------------
function DrilldownModal({ drill, data, loading, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-900">Underlying records</h3>
            <p className="text-sm text-slate-500">{drill.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading records…</p>
          ) : data?.error ? (
            <p className="py-8 text-center text-sm text-brand-danger">{data.error}</p>
          ) : !data || data.count === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No underlying records for this period.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                <strong>{data.count}</strong> record(s) produced this total.
              </p>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Resident / Household</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Age / Sex</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.records.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {fullName(r.resident) || r.member?.name || r.household?.head_name || r.household_id || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.date || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{[r.ageGroup, r.sex].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{r.status || "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record M1 activity modal
// ---------------------------------------------------------------------------
function RecordModal({ catalog, residents, onClose, onSaved }) {
  const recordable = useMemo(
    () => (catalog.indicators || []).filter((i) => i.source === "m1_records"),
    [catalog],
  );
  const sections = useMemo(() => {
    const set = new Set(recordable.map((i) => i.section));
    return SECTION_ORDER.filter((s) => set.has(s));
  }, [recordable]);

  const [section, setSection] = useState(sections[0] || "A");
  const sectionInds = recordable.filter((i) => i.section === section);
  const [code, setCode] = useState(sectionInds[0]?.code || "");
  const [resident, setResident] = useState(null);
  const [recordDate, setRecordDate] = useState(todayStr());
  const [value, setValue] = useState(1);
  const [sex, setSex] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [remarks, setRemarks] = useState("");
  const [measure, setMeasure] = useState("current_end");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const list = recordable.filter((i) => i.section === section);
    setCode(list[0]?.code || "");
  }, [section, recordable]);

  const indicator = recordable.find((i) => i.code === code);
  const isFp = indicator?.dataType === "fp_method" || indicator?.dataType === "fp_total";

  const submit = async () => {
    setErr("");
    if (!code) { setErr("Select an indicator."); return; }
    setSaving(true);
    try {
      const detail = isFp ? { measure } : {};
      await m1Api.createRecord({
        indicator_code: code,
        residentId: resident?.id || null,
        record_date: recordDate,
        value: Number(value) || 1,
        sex: sex || "",
        age_group: ageGroup || "",
        remarks,
        detail,
      });
      onSaved();
    } catch (e) {
      setErr(e?.message || "Failed to save record.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Record M1 Activity</h3>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          {err && <div className="rounded-lg bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Section</span>
              <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {sections.map((s) => <option key={s} value={s}>{s} — {SECTION_TITLES[s]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Indicator</span>
              <select value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {sectionInds.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Resident (optional for barangay-level indicators)</span>
            <ResidentSearchSelect residents={residents} value={resident} onChange={setResident} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Date</span>
              <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Value / Count</span>
              <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </div>

          {isFp && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">FP Measure</span>
              <select value={measure} onChange={(e) => setMeasure(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {(catalog.fpMeasures || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Sex (override)</span>
              <select value={sex} onChange={(e) => setSex(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Auto (from resident)</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Age group (override)</span>
              <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Auto (from birth date)</option>
                {(indicator?.ageGroups || []).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Remarks</span>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button onClick={onClose} className="rounded-btn border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue/90 disabled:opacity-60">
            {saving ? "Saving…" : "Save Record"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print report — compact, official-style M1 form (all sections, all indicators)
// ---------------------------------------------------------------------------
function PrintReport({ monthly, groups, meta, periodLabel, barangay }) {
  return (
    <div className="m1-print">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .m1-print, .m1-print * { visibility: visible; }
          .m1-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .m1-print table { page-break-inside: auto; }
          .m1-print tr { page-break-inside: avoid; }
          .m1-print .m1-section { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 12mm; }
        }
        .m1-print table { border-collapse: collapse; width: 100%; }
        .m1-print th, .m1-print td { border: 1px solid #94a3b8; padding: 2px 5px; font-size: 10px; }
        .m1-print thead th { background: #0B4A8F; color: #fff; }
        .m1-print .m1-sec-head { background: #0B4A8F; color: #fff; font-weight: 700; padding: 4px 6px; font-size: 11px; }
      `}</style>

      <div className="mb-3 text-center">
        <h2 className="text-lg font-bold">FHSIS — Monthly Form M1</h2>
        <p className="text-sm">Program Accomplishment / Service Coverage Report</p>
      </div>
      <table className="mb-3">
        <tbody>
          <tr>
            <td><strong>Reporting Period:</strong> {periodLabel}</td>
            <td><strong>Barangay:</strong> {meta?.barangay?.name || barangay || ""}</td>
            <td><strong>BHS / Facility:</strong> {meta?.meta?.bhs_name || meta?.barangay?.healthStation || ""}</td>
          </tr>
          <tr>
            <td><strong>Municipality/City:</strong> {meta?.municipality || ""}</td>
            <td><strong>Province:</strong> {meta?.province || ""}</td>
            <td><strong>Projected Population:</strong> {meta?.meta?.projected_population ?? ""}</td>
          </tr>
          <tr>
            <td><strong>Prepared by:</strong> {meta?.meta?.prepared_by || ""}</td>
            <td><strong>Designation:</strong> {meta?.meta?.designation || ""}</td>
            <td><strong>Validated by:</strong> {meta?.meta?.validated_by || ""}</td>
          </tr>
        </tbody>
      </table>

      {!monthly ? (
        <p>No data.</p>
      ) : (
        groups.map((g) => (
          <div key={g.section} className="m1-section mb-4">
            <div className="m1-sec-head">SECTION {g.section} — {g.title}</div>
            {g.subsections.map((sub) => (
              <div key={sub.subsection}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "6%" }}>Code</th>
                      <th style={{ textAlign: "left" }}>{sub.subsection}</th>
                      <th style={{ width: "10%" }}>Male</th>
                      <th style={{ width: "10%" }}>Female</th>
                      <th style={{ width: "10%" }}>Total</th>
                      <th style={{ width: "18%" }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.items.map((it) => (
                      <tr key={it.code}>
                        <td>{it.code}</td>
                        <td style={{ textAlign: "left" }}>
                          {it.name}
                          {it.ageGroups?.length > 1 && (
                            <span style={{ color: "#475569" }}> ({it.ageGroups.map((a) => `${a}: ${it.byAge?.[a] ?? 0}`).join(", ")})</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>{it.sexBreakdown ? (it.bySex?.Male ?? 0) : ""}</td>
                        <td style={{ textAlign: "right" }}>{it.sexBreakdown ? (it.bySex?.Female ?? 0) : ""}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{it.total ?? 0}</td>
                        <td>{it.remarks || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
