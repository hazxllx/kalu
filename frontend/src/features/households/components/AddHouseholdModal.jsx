import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
  Info,
  CheckCircle2,
  CloudOff,
  Home,
} from "lucide-react";
import HHBadge from "./HHBadge";
import {
  HH_STATUSES,
  APPROVAL_STATUSES,
  PUROKS,
  WATER_SOURCES,
  WATER_SOURCE_LABELS,
  WATER_TYPES,
  WATER_DISTANCES,
  WATER_AVAILABILITY,
  TREATMENT_METHODS,
  TOILET_TYPES,
  TOILET_LABELS,
  SANITATION_ACCESS,
  WASTE_DISPOSAL,
  PHILHEALTH_CATEGORIES,
  CLASSIFICATIONS,
  QUARTER_STATUSES,
  RELATIONSHIPS,
  FP_METHODS,
  SEX_OPTIONS,
  computeHouseholdRisk,
  householdFlags,
} from "../lib/householdOptions";

const inputCls = (error) =>
  `w-full bg-white border rounded-input px-3 py-2 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const cellCls = (error) =>
  `w-full bg-white border rounded-input px-2 py-1.5 text-xs text-brand-ink outline-none transition-colors focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const today = () => new Date().toISOString().slice(0, 10);

const emptyMember = () => ({
  name: "",
  relationship: "",
  sex: "",
  age: "",
  birthday: "",
  classification: "",
  pwd: false,
  philhealth: "",
  q1: "",
  q2: "",
  q3: "",
  q4: "",
  remarks: "",
  fpMethod: "None",
});

function ageFromBirthday(birthday) {
  if (!birthday) return "";
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

function Field({ label, required, error, hint, children, className = "" }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-brand-ink">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-brand-gray">{hint}</p>
      ) : null}
    </div>
  );
}

function RadioRow({ name, value, options, onChange }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
          <input
            type="radio"
            name={name}
            checked={value === o}
            onChange={() => onChange(o)}
            className="h-4 w-4 accent-brand-blue"
          />
          {o}
        </label>
      ))}
    </div>
  );
}

function Section({ id, index, title, open, onToggle, right = null, children }) {
  return (
    <div className="rounded-btn border border-brand-border bg-white">
      <div
        className={`flex w-full items-center justify-between gap-3 rounded-t-btn bg-brand-bg/70 px-4 py-3 ${
          open ? "border-b border-brand-border" : "rounded-b-btn"
        }`}
      >
        <button type="button" onClick={() => onToggle(id)} className="flex flex-1 items-center gap-3 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-blue text-[11px] font-bold text-white">
            {index}
          </span>
          <span className="text-sm font-semibold text-brand-ink">{title}</span>
        </button>
        {right}
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="shrink-0 text-brand-gray transition-colors hover:text-brand-ink"
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

const FIELD_SECTIONS = {
  head: "tracking",
  purok: "tracking",
  streetAddress: "tracking",
  families: "tracking",
  respLast: "respondent",
  respFirst: "respondent",
  respMaiden: "respondent",
  waterSource: "water",
  toilet: "water",
};

/**
 * Add New Household slide-over panel. Sections mirror the barangay household
 * profiling form; the risk classification and auto-flags update live.
 *
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param (household: object) => void props.onSave
 * @param {string} props.householdId auto-generated next household id
 * @param {string[]} props.bhwOptions registered BHWs for the collector dropdown
 * @param {string} props.defaultCollector logged-in user (editable)
 */
export default function AddHouseholdModal({ open, onClose, onSave, householdId, bhwOptions, defaultCollector }) {
  const [openSections, setOpenSections] = useState({
    tracking: true,
    visits: false,
    respondent: true,
    philhealth: false,
    water: true,
    members: true,
    risk: true,
  });
  const [errors, setErrors] = useState({});
  const [memberErrors, setMemberErrors] = useState([]);
  const [form, setForm] = useState(() => ({
    head: "",
    purok: "",
    streetAddress: "",
    contact: "",
    families: "1",
    collector: defaultCollector || (bhwOptions && bhwOptions[0]) || "",
    hhStatus: "Pending",
    approval: "Not yet approved",
    income: "",
    visits: { q1: "", q2: "", q3: "", q4: "" },
    respLast: "",
    respFirst: "",
    respMaiden: "",
    nhts: "",
    ip: "",
    phMember: "",
    phId: "",
    phCategory: "",
    waterSource: "",
    waterType: "",
    waterDistance: "",
    waterAvailability: "",
    treatWater: "",
    treatmentMethods: [],
    treatmentOther: "",
    toilet: "",
    sanitationAccess: "",
    wasteDisposal: "",
    segregation: "",
    members: [emptyMember()],
  }));

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleSection = (id) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const updateMember = (idx, key, value) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.map((m, i) => {
        if (i !== idx) return m;
        const next = { ...m, [key]: value };
        if (key === "birthday") {
          const age = ageFromBirthday(value);
          if (age !== "") next.age = age;
        }
        return next;
      }),
    }));

  const addMember = () =>
    setForm((prev) => ({ ...prev, members: [...prev.members, emptyMember()] }));

  const removeMember = (idx) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.length > 1 ? prev.members.filter((_, i) => i !== idx) : prev.members,
    }));

  const toggleTreatment = (method) =>
    setForm((prev) => ({
      ...prev,
      treatmentMethods: prev.treatmentMethods.includes(method)
        ? prev.treatmentMethods.filter((m) => m !== method)
        : [...prev.treatmentMethods, method],
    }));

  const risk = useMemo(() => computeHouseholdRisk(form), [form]);
  const flags = useMemo(() => householdFlags(form), [form]);
  const hasMemberErrors = memberErrors.some((m) => Object.values(m).some(Boolean));
  const showDistance = form.waterSource && form.waterSource !== "level3";

  const validate = () => {
    const next = {};
    if (!form.head.trim()) next.head = "Household Head Name is required.";
    if (!form.purok) next.purok = "Purok/Zone is required.";
    if (!form.streetAddress.trim()) next.streetAddress = "Street Address / Sitio is required.";
    if (!form.families || Number(form.families) < 1) next.families = "Enter at least 1 family.";
    if (!form.respLast.trim()) next.respLast = "Last Name is required.";
    if (!form.respFirst.trim()) next.respFirst = "First Name is required.";
    if (!form.respMaiden.trim()) next.respMaiden = "Mother's Maiden Name is required.";
    if (!form.waterSource) next.waterSource = "Primary Water Source is required.";
    if (!form.toilet) next.toilet = "Toilet Facility Type is required.";
    const mErrors = form.members.map((m) => ({
      name: m.name.trim() ? "" : "Name is required.",
      relationship: m.relationship ? "" : "Relationship is required.",
      sex: m.sex ? "" : "Sex is required.",
    }));
    return { errors: next, memberErrors: mErrors };
  };

  const buildHousehold = () => {
    const members = form.members.map((m) => ({ ...m, age: m.age === "" ? "" : Number(m.age) }));
    const computed = computeHouseholdRisk({ ...form, members });
    const autoFlags = householdFlags({ ...form, members });
    const incomeNum = Number(form.income) || 0;
    return {
      id: householdId,
      head: form.head.trim(),
      purok: form.purok,
      streetAddress: form.streetAddress.trim(),
      contact: form.contact.trim(),
      families: Number(form.families) || 1,
      collector: form.collector,
      hhStatus: form.hhStatus,
      approval: form.approval,
      income: incomeNum > 0 ? `₱${incomeNum.toLocaleString()}/mo` : "—",
      incomeNum,
      lastUpdated: today(),
      address: `${form.streetAddress.trim()}, ${form.purok}`,
      members: members.length,
      memberList: members,
      water: WATER_SOURCE_LABELS[form.waterSource] || "—",
      waterSource: form.waterSource,
      waterType: form.waterType,
      waterDistance: form.waterDistance,
      waterAvailability: form.waterAvailability,
      treatment:
        form.treatWater === "Yes" && form.treatmentMethods.length > 0
          ? form.treatmentMethods.join(", ")
          : "None",
      toilet: TOILET_LABELS[form.toilet] || "—",
      toiletType: form.toilet,
      sanitationAccess: form.sanitationAccess,
      wasteDisposal: form.wasteDisposal,
      segregation: form.segregation,
      visits: form.visits,
      respondent: `${form.respLast.trim()}, ${form.respFirst.trim()}`,
      nhts: form.nhts || "—",
      ip: form.ip || "—",
      philhealth:
        form.phMember === "Yes"
          ? { id: form.phId.trim(), category: form.phCategory }
          : null,
      riskScore: computed.score,
      riskLevel: computed.level,
      riskFactors: computed.factors,
      flags: autoFlags,
      concerns: [...new Set([...autoFlags, ...computed.factors])],
    };
  };

  const handleSave = () => {
    const { errors: nextErrors, memberErrors: nextMemberErrors } = validate();
    const membersInvalid = nextMemberErrors.some((m) => Object.values(m).some(Boolean));
    setErrors(nextErrors);
    setMemberErrors(nextMemberErrors);
    if (Object.keys(nextErrors).length > 0 || membersInvalid) {
      setOpenSections((prev) => {
        const toOpen = { ...prev };
        Object.keys(nextErrors).forEach((k) => {
          const s = FIELD_SECTIONS[k];
          if (s) toOpen[s] = true;
        });
        if (membersInvalid) toOpen.members = true;
        return toOpen;
      });
      return;
    }
    onSave(buildHousehold());
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brand-deep/60"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
        className="absolute right-0 top-0 flex h-full w-full flex-col bg-brand-bg shadow-2xl sm:max-w-2xl lg:max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-label="Add New Household"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light">
              <Home className="h-5 w-5 text-brand-blue" strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="font-heading font-semibold text-brand-ink">Add New Household</h3>
              <p className="text-xs text-brand-gray">
                {householdId} · auto-generated · risk classification updates live
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray hover:bg-brand-bg hover:text-brand-ink"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {/* 1 — Household Tracking Info */}
          <Section
            id="tracking"
            index={1}
            title="Household Tracking Info"
            open={openSections.tracking}
            onToggle={toggleSection}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Household ID" hint="Auto-generated, read-only">
                <input readOnly value={householdId} className="w-full rounded-input border border-brand-border bg-brand-bg px-3 py-2 text-sm font-semibold text-brand-ink outline-none" />
              </Field>
              <Field label="Household Head Name" required error={errors.head}>
                <input
                  type="text"
                  value={form.head}
                  onChange={(e) => set("head", e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className={inputCls(errors.head)}
                />
              </Field>
              <Field label="Purok/Zone" required error={errors.purok}>
                <select value={form.purok} onChange={(e) => set("purok", e.target.value)} className={`${inputCls(errors.purok)} cursor-pointer`}>
                  <option value="">Select purok/zone...</option>
                  {PUROKS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Street Address / Sitio" required error={errors.streetAddress}>
                <input
                  type="text"
                  value={form.streetAddress}
                  onChange={(e) => set("streetAddress", e.target.value)}
                  placeholder="e.g. 12 Mabini St., Sitio Riverside"
                  className={inputCls(errors.streetAddress)}
                />
              </Field>
              <Field label="Contact Number" hint="Optional">
                <input
                  type="text"
                  value={form.contact}
                  onChange={(e) => set("contact", e.target.value)}
                  placeholder="e.g. 09XX XXX XXXX"
                  className={inputCls()}
                />
              </Field>
              <Field label="Number of Families in the Household" required error={errors.families} hint="A household can have more than one family">
                <input
                  type="number"
                  min="1"
                  value={form.families}
                  onChange={(e) => set("families", e.target.value)}
                  className={inputCls(errors.families)}
                />
              </Field>
              <Field label="Assigned Data Collector / BHW" hint="Auto-filled with the logged-in user — editable">
                <select value={form.collector} onChange={(e) => set("collector", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {bhwOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estimated Monthly Income (₱)" hint="Optional — used in risk classification">
                <input
                  type="number"
                  min="0"
                  value={form.income}
                  onChange={(e) => set("income", e.target.value)}
                  placeholder="e.g. 9500"
                  className={inputCls()}
                />
              </Field>
              <Field label="HH Status">
                <select value={form.hhStatus} onChange={(e) => set("hhStatus", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {HH_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Approval Status (this quarter)">
                <select value={form.approval} onChange={(e) => set("approval", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {APPROVAL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Last Updated" hint="Auto date, read-only">
                <input readOnly value={today()} className="w-full rounded-input border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-ink outline-none" />
              </Field>
            </div>
          </Section>

          {/* 2 — Visit Tracking */}
          <Section id="visits" index={2} title="Visit Tracking" open={openSections.visits} onToggle={toggleSection}>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { key: "q1", label: "First Quarter Date of Visit" },
                { key: "q2", label: "Second Quarter Date of Visit" },
                { key: "q3", label: "Third Quarter Date of Visit" },
                { key: "q4", label: "Fourth Quarter Date of Visit" },
              ].map((v) => (
                <Field key={v.key} label={v.label}>
                  <input
                    type="date"
                    value={form.visits[v.key]}
                    onChange={(e) => set("visits", { ...form.visits, [v.key]: e.target.value })}
                    className={inputCls()}
                  />
                </Field>
              ))}
            </div>
          </Section>

          {/* 3 — Respondent Information */}
          <Section
            id="respondent"
            index={3}
            title="Respondent Information"
            open={openSections.respondent}
            onToggle={toggleSection}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Last Name" required error={errors.respLast}>
                <input type="text" value={form.respLast} onChange={(e) => set("respLast", e.target.value)} placeholder="Dela Cruz" className={inputCls(errors.respLast)} />
              </Field>
              <Field label="First Name" required error={errors.respFirst}>
                <input type="text" value={form.respFirst} onChange={(e) => set("respFirst", e.target.value)} placeholder="Juan" className={inputCls(errors.respFirst)} />
              </Field>
              <Field label="Mother's Maiden Name" required error={errors.respMaiden}>
                <input type="text" value={form.respMaiden} onChange={(e) => set("respMaiden", e.target.value)} placeholder="Reyes" className={inputCls(errors.respMaiden)} />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="NHTS Household Status">
                <RadioRow name="nhts" value={form.nhts} onChange={(v) => set("nhts", v)} options={["NHTS-4Ps", "NHTS Non-4Ps", "Non-NHTS"]} />
              </Field>
              <Field label="Indigenous People Status">
                <RadioRow name="ip" value={form.ip} onChange={(v) => set("ip", v)} options={["IP", "Non-IP"]} />
              </Field>
            </div>
          </Section>

          {/* 4 — HH Head PhilHealth Info */}
          <Section
            id="philhealth"
            index={4}
            title="HH Head PhilHealth Info"
            open={openSections.philhealth}
            onToggle={toggleSection}
          >
            <Field label="PhilHealth Member?">
              <RadioRow name="phMember" value={form.phMember} onChange={(v) => set("phMember", v)} options={["No", "Yes"]} />
            </Field>
            {form.phMember === "Yes" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="PhilHealth ID No.">
                  <input
                    type="text"
                    value={form.phId}
                    onChange={(e) => set("phId", e.target.value)}
                    placeholder="e.g. 00-123456789-0"
                    className={inputCls()}
                  />
                </Field>
                <Field label="Category">
                  <select value={form.phCategory} onChange={(e) => set("phCategory", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">Select category...</option>
                    {PHILHEALTH_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </Section>

          {/* 5 — Water Source & Sanitation Details */}
          <Section
            id="water"
            index={5}
            title="Water Source & Sanitation Details"
            open={openSections.water}
            onToggle={toggleSection}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary Water Source" required error={errors.waterSource} className="sm:col-span-2">
                <select value={form.waterSource} onChange={(e) => set("waterSource", e.target.value)} className={`${inputCls(errors.waterSource)} cursor-pointer`}>
                  <option value="">Select water source level...</option>
                  {WATER_SOURCES.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Water Source Type Detail">
                <select value={form.waterType} onChange={(e) => set("waterType", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  <option value="">Select water source type...</option>
                  {WATER_TYPES.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </Field>
              {showDistance && (
                <Field label="Distance to Water Source" hint="Shown when the source is not in-house">
                  <select value={form.waterDistance} onChange={(e) => set("waterDistance", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                    <option value="">Select distance...</option>
                    {WATER_DISTANCES.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Water Availability">
                <select value={form.waterAvailability} onChange={(e) => set("waterAvailability", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  <option value="">Select availability...</option>
                  {WATER_AVAILABILITY.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </Field>
              <Field label="Toilet Facility Type" required error={errors.toilet}>
                <select value={form.toilet} onChange={(e) => set("toilet", e.target.value)} className={`${inputCls(errors.toilet)} cursor-pointer`}>
                  <option value="">Select toilet facility...</option>
                  {TOILET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sanitation Facility Access">
                <select value={form.sanitationAccess} onChange={(e) => set("sanitationAccess", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  <option value="">Select access...</option>
                  {SANITATION_ACCESS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Waste Disposal Method">
                <select value={form.wasteDisposal} onChange={(e) => set("wasteDisposal", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  <option value="">Select waste disposal...</option>
                  {WASTE_DISPOSAL.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </Field>
              <Field label="Segregation Practiced?">
                <RadioRow name="segregation" value={form.segregation} onChange={(v) => set("segregation", v)} options={["Yes", "No"]} />
              </Field>
              <Field label="Water Treatment Practiced at Home?" className="sm:col-span-2">
                <RadioRow name="treatWater" value={form.treatWater} onChange={(v) => set("treatWater", v)} options={["Yes", "No"]} />
              </Field>
              {form.treatWater === "Yes" && (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-sm font-medium text-brand-ink">Treatment methods</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {TREATMENT_METHODS.map((t) => (
                      <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
                        <input
                          type="checkbox"
                          checked={form.treatmentMethods.includes(t)}
                          onChange={() => toggleTreatment(t)}
                          className="h-4 w-4 rounded accent-brand-blue"
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                  {form.treatmentMethods.includes("Other") && (
                    <input
                      type="text"
                      value={form.treatmentOther}
                      onChange={(e) => set("treatmentOther", e.target.value)}
                      placeholder="Other treatment method (specify)..."
                      className={`${inputCls()} mt-3`}
                    />
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* 6 — Household Members Table */}
          <Section
            id="members"
            index={6}
            title="Household Members"
            open={openSections.members}
            onToggle={toggleSection}
            right={
              <div className="group relative">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-blue"
                >
                  <Info className="h-3.5 w-3.5" /> Classification legend
                </button>
                <div className="pointer-events-none absolute right-0 top-7 z-30 hidden w-72 rounded-btn border border-brand-border bg-white p-3 shadow-float group-hover:block">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                    Age / Health Risk Classification
                  </p>
                  <div className="space-y-1">
                    {CLASSIFICATIONS.map((c) => (
                      <p key={c.value} className="text-xs text-brand-gray">
                        <span className="font-semibold text-brand-ink">{c.value}</span>
                        {" — "}
                        {c.label.split("— ")[1]}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            }
          >
            {hasMemberErrors && (
              <div className="mb-3 flex items-center gap-2 rounded-btn border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Some member rows are incomplete — fill in the highlighted fields or remove the row.
              </div>
            )}
            <div className="overflow-x-auto rounded-btn border border-brand-border bg-white">
              <table className="w-full min-w-[1150px] text-left">
                <thead>
                  <tr className="border-b border-brand-border bg-brand-bg text-[10px] uppercase tracking-wide text-brand-gray">
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Relationship to HH Head</th>
                    <th className="px-2 py-2">Sex</th>
                    <th className="px-2 py-2">Birthday</th>
                    <th className="px-2 py-2">Age</th>
                    <th className="px-2 py-2">Classification</th>
                    <th className="px-2 py-2 text-center">PWD</th>
                    <th className="px-2 py-2">PhilHealth</th>
                    <th className="px-2 py-2">Q1</th>
                    <th className="px-2 py-2">Q2</th>
                    <th className="px-2 py-2">Q3</th>
                    <th className="px-2 py-2">Q4</th>
                    <th className="px-2 py-2">Remarks</th>
                    <th className="px-2 py-2">Family Planning Method</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {form.members.map((m, i) => {
                    const me = memberErrors[i] || {};
                    return (
                      <tr key={i} className="border-b border-brand-border last:border-0 align-top">
                        <td className="px-2 py-2 text-xs font-semibold text-brand-gray">{i + 1}</td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={m.name}
                            onChange={(e) => updateMember(i, "name", e.target.value)}
                            placeholder="Member name"
                            className={cellCls(me.name)}
                          />
                          {me.name && <p className="mt-1 text-[10px] text-red-600">{me.name}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <select value={m.relationship} onChange={(e) => updateMember(i, "relationship", e.target.value)} className={`${cellCls(me.relationship)} cursor-pointer`}>
                            <option value="">Select...</option>
                            {RELATIONSHIPS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={m.sex} onChange={(e) => updateMember(i, "sex", e.target.value)} className={`${cellCls(me.sex)} cursor-pointer`}>
                            <option value="">Select...</option>
                            {SEX_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="date" value={m.birthday} onChange={(e) => updateMember(i, "birthday", e.target.value)} className={cellCls()} />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            value={m.age}
                            onChange={(e) => updateMember(i, "age", e.target.value)}
                            placeholder="—"
                            className={`${cellCls()} w-14`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select value={m.classification} onChange={(e) => updateMember(i, "classification", e.target.value)} className={`${cellCls()} cursor-pointer`}>
                            <option value="">Select...</option>
                            {CLASSIFICATIONS.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={m.pwd}
                            onChange={(e) => updateMember(i, "pwd", e.target.checked)}
                            className="h-4 w-4 accent-brand-blue"
                            aria-label={`Member ${i + 1} is a PWD`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select value={m.philhealth} onChange={(e) => updateMember(i, "philhealth", e.target.value)} className={`${cellCls()} w-24 cursor-pointer`}>
                            <option value="">Unspecified</option>
                            <option value="member">Member</option>
                            <option value="non-member">Non-member</option>
                          </select>
                        </td>
                        {["q1", "q2", "q3", "q4"].map((q) => (
                          <td key={q} className="px-2 py-2">
                            <select value={m[q]} onChange={(e) => updateMember(i, q, e.target.value)} className={`${cellCls()} w-[74px] cursor-pointer`}>
                              <option value="">—</option>
                              {QUARTER_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          <input type="text" value={m.remarks} onChange={(e) => updateMember(i, "remarks", e.target.value)} placeholder="—" className={`${cellCls()} w-28`} />
                        </td>
                        <td className="px-2 py-2">
                          <select value={m.fpMethod} onChange={(e) => updateMember(i, "fpMethod", e.target.value)} className={`${cellCls()} w-32 cursor-pointer`}>
                            {FP_METHODS.map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeMember(i)}
                            disabled={form.members.length === 1}
                            className="flex h-7 w-7 items-center justify-center rounded-btn border border-brand-border text-brand-gray transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Remove member ${i + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addMember}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-brand-border bg-white py-2.5 text-sm font-medium text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-light"
            >
              <Plus className="h-4 w-4" /> Add Member
            </button>
          </Section>

          {/* 7 — Auto-Calculated Risk Classification */}
          <Section
            id="risk"
            index={7}
            title="Auto-Calculated Risk Classification"
            open={openSections.risk}
            onToggle={toggleSection}
          >
            <div className="rounded-btn border border-brand-border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <HHBadge value={risk.level} label={`${risk.level} Risk`} />
                  <span className="text-xs text-brand-gray">
                    Risk score <span className="font-semibold text-brand-ink">{risk.score}/100</span> — computed live
                  </span>
                </div>
                <span className="text-[11px] text-brand-gray">
                  From water source, toilet, sanitation access, vulnerable members & income
                </span>
              </div>
              {risk.factors.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {risk.factors.map((f) => (
                    <span key={f} className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-blue">{f}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-brand-gray">No risk factors recorded yet — fill in the sections above.</p>
              )}

              <div className="mt-4 space-y-2.5">
                {flags.includes("Sanitation Risk") && (
                  <div className="flex items-start gap-2.5 rounded-btn border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>Sanitation Risk</strong> — unsafe water source (Level I / Unimproved) or no toilet
                      facility. Tagged for environmental sanitation follow-up.
                    </span>
                  </div>
                )}
                {flags
                  .filter((f) => f !== "Sanitation Risk")
                  .map((f) => (
                    <div key={f} className="flex items-start gap-2.5 rounded-btn border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                {flags.length === 0 && (
                  <div className="flex items-start gap-2.5 rounded-btn border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>No auto-flags detected for this household.</span>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-brand-border bg-white px-5 py-4">
          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-brand-gray">
              <CloudOff className="h-3.5 w-3.5" />
              Saved locally when offline — tagged "Pending Sync" and queued automatically.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-btn border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                Save Household
              </button>
            </div>
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
