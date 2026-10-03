import React, { useEffect, useMemo, useState } from "react";
import { X, CheckCircle2, Save, ClipboardList } from "lucide-react";
import { Card } from "@/components/common/Card";
import { m1Api } from "@/services/api";

/**
 * M1 Data Entry — manual aggregate reporting figures.
 *
 * This is DELIBERATELY separate from "New Maternal Record": a maternal record is
 * an individual case; this screen records the FHSIS M1 program indicators that
 * have no operational record anywhere in KALUSAGAP (e.g. screenings, oral/NCD
 * service counts, fetal deaths). The health supervisor picks a Reporting Year,
 * Reporting Month, Section and Indicator and enters the required values by the
 * indicator's age or sex breakdown; the values are SAVED TO THE DATABASE
 * (m1_manual_entries, server-side, barangay-scoped) and re-saving an indicator
 * UPDATES the stored figure in place instead of creating duplicates.
 *
 * Indicators that are already derived from operational records (maternal cases,
 * immunizations, households, mortality) never appear here, so no value is ever
 * counted twice.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SECTION_TITLES = {
  A: "A. Family Planning",
  B: "B. Maternal Care",
  C: "C. Child Care",
  D: "D. Oral Care",
  E: "E. Infectious Disease",
  F: "F. Non-Communicable Disease",
  G: "G. Environmental Health",
  H: "H. Mortality & Natality",
};

const SEXES = ["Male", "Female"];

/** The input buckets an indicator needs, from its age/sex breakdown. */
const bucketsFor = (ind) => {
  if (!ind) return [];
  const ages = ind.ageScheme && ind.ageScheme !== "none" ? ind.ageGroups : null;
  const sexes = ind.sexBreakdown ? SEXES : null;
  const out = [];
  if (ages && sexes) {
    for (const a of ages) for (const s of sexes) out.push({ age_group: a, sex: s, label: `${a} · ${s}` });
  } else if (ages) {
    for (const a of ages) out.push({ age_group: a, sex: "", label: a });
  } else if (sexes) {
    for (const s of sexes) out.push({ age_group: "Total", sex: s, label: s });
  } else {
    out.push({ age_group: "Total", sex: "", label: "Total" });
  }
  return out;
};

const bucketKey = (b) => `${b.age_group}|${b.sex}`;

const inputCls =
  "mt-1.5 w-full rounded-btn border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue";

export default function M1DataEntryModal({ onClose, onSaved, initialSection, initialYear, initialMonth }) {
  const now = new Date();
  const [year, setYear] = useState(initialYear || now.getFullYear());
  const [month, setMonth] = useState(initialMonth || now.getMonth() + 1); // 1-12 for the API
  const [indicators, setIndicators] = useState([]);
  const [entries, setEntries] = useState([]);
  const [remarksMap, setRemarksMap] = useState({});
  const [section, setSection] = useState(initialSection || "B");
  const [code, setCode] = useState("");
  const [values, setValues] = useState({}); // bucketKey -> string
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedNote, setSavedNote] = useState("");

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2, y - 3];
  }, [now]);

  // Load the manual indicator catalog + stored figures for the selected month.
  const loadMonth = React.useCallback(() => {
    setLoading(true);
    setError(null);
    return m1Api
      .listManual({ year, month })
      .then((res) => {
        setIndicators(res?.indicators || []);
        setEntries(res?.entries || []);
        setRemarksMap(res?.remarks || {});
      })
      .catch((e) => setError(e?.message || "Could not load M1 data entry."))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  const sections = useMemo(() => {
    const set = new Set(indicators.map((i) => i.section));
    return [...set].sort();
  }, [indicators]);

  const sectionIndicators = useMemo(
    () => indicators.filter((i) => i.section === section),
    [indicators, section],
  );

  const current = useMemo(() => indicators.find((i) => i.code === code) || null, [indicators, code]);
  const buckets = useMemo(() => bucketsFor(current), [current]);

  // When the section changes (or indicators load), default to its first indicator.
  useEffect(() => {
    if (!sectionIndicators.length) { setCode(""); return; }
    if (!sectionIndicators.some((i) => i.code === code)) setCode(sectionIndicators[0].code);
  }, [sectionIndicators, code]);

  // Pre-fill the inputs with the stored values for the selected indicator/month.
  useEffect(() => {
    if (!current) { setValues({}); setRemarks(""); return; }
    const next = {};
    for (const b of bucketsFor(current)) {
      const match = entries.find(
        (e) => e.indicator_code === current.code && (e.age_group || "Total") === b.age_group && (e.sex || "") === b.sex,
      );
      next[bucketKey(b)] = match ? String(match.value) : "";
    }
    setValues(next);
    setRemarks(remarksMap[current.code] || "");
    setSavedNote("");
  }, [current, entries, remarksMap]);

  const total = useMemo(
    () => buckets.reduce((s, b) => s + (Number(values[bucketKey(b)]) || 0), 0),
    [buckets, values],
  );

  const setBucket = (key) => (v) => setValues((p) => ({ ...p, [key]: v }));

  const handleSave = async () => {
    if (!current || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payloadValues = buckets.map((b) => ({
        age_group: b.age_group,
        sex: b.sex,
        value: Number(values[bucketKey(b)]) || 0,
      }));
      await m1Api.saveManual({
        year,
        month,
        indicatorCode: current.code,
        values: payloadValues,
        remarks,
      });
      await loadMonth();
      setSavedNote(`Saved ${current.code} for ${MONTHS[month - 1]} ${year}.`);
      if (onSaved) onSaved();
    } catch (e) {
      setError(e?.message || "Could not save the M1 data.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-brand-ink">
                <ClipboardList className="h-5 w-5 text-brand-blue" /> Record M1 Data
              </h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                Enter FHSIS M1 reporting indicators that are not derived from operational records. Saved to the database and used by the Monthly, Quarterly and Annual reports.
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Period + indicator selectors */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-brand-ink">Reporting Year</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Reporting Month</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Section</label>
              <select value={section} onChange={(e) => setSection(e.target.value)} className={`${inputCls} cursor-pointer`}>
                {sections.map((s) => <option key={s} value={s}>{SECTION_TITLES[s] || s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Indicator</label>
              <select value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} cursor-pointer`}>
                {sectionIndicators.map((i) => <option key={i.code} value={i.code}>{i.code} — {i.name}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="mt-4 rounded-btn bg-brand-danger/10 px-3.5 py-2.5 text-sm text-brand-danger">{error}</p>}

          {loading ? (
            <p className="py-10 text-center text-sm text-brand-gray">Loading…</p>
          ) : current ? (
            <div className="mt-5">
              <div className="rounded-btn bg-brand-bg px-3.5 py-3">
                <p className="text-sm font-medium text-brand-ink">{current.name}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-brand-gray">{current.subsection}</p>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {buckets.map((b) => (
                  <div key={bucketKey(b)}>
                    <label className="text-sm font-medium text-brand-ink">{b.label}</label>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={values[bucketKey(b)] ?? ""}
                      onChange={(e) => setBucket(bucketKey(b))(e.target.value)}
                      placeholder="0"
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>

              {buckets.length > 1 && (
                <p className="mt-3 text-sm text-brand-gray">
                  Total: <span className="font-stat font-bold text-brand-ink">{total}</span>
                  <span className="ml-2 text-[11px]">(derived from the entered values — not entered directly)</span>
                </p>
              )}

              {current.remarksAllowed && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-brand-ink">Remarks</label>
                  <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional remarks for this indicator…" className={`${inputCls} resize-none`} />
                </div>
              )}

              {savedNote && (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-brand-green">
                  <CheckCircle2 className="h-4 w-4" /> {savedNote}
                </p>
              )}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-brand-gray">No manual indicators found for this section.</p>
          )}

          <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
            <button
              disabled={saving || loading || !current}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save M1 Data"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
