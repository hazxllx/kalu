import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  AlertTriangle,
  Info,
  CheckCircle2,
  CloudOff,
  Home,
  ArrowLeft,
} from "lucide-react";
import HHBadge from "../components/HHBadge";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import {
  useHouseholds,
  useHouseholdSyncStatus,
  householdStore,
} from "@/services/mock/householdStore";
import { systemUsers } from "@/services/mock/mockData";
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

const ACTIVE_BHWS = systemUsers
  .filter((u) => u.role === "BHW" && u.status === "Active")
  .map((u) => u.name);

function bhwOptionsFor(defaultCollector) {
  const base = ACTIVE_BHWS.length > 0 ? ACTIVE_BHWS : ["Maria Cruz", "Lourdes Ramos"];
  return defaultCollector && !base.includes(defaultCollector)
    ? [defaultCollector, ...base]
    : base;
}

const inputCls = (error) =>
  `w-full bg-white border rounded-input px-3.5 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const cellCls = (error) =>
  `w-full bg-white border rounded-input px-2 py-1.5 text-xs text-brand-ink outline-none transition-colors focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const readOnlyCls =
  "w-full rounded-input border border-brand-border bg-brand-bg px-3.5 py-2.5 text-sm font-semibold text-brand-ink outline-none";

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

/**
 * Mobile/tablet household member editor. Each member is a card with labelled
 * full-width inputs, so BHWs on phones are not forced into a wide horizontal
 * data grid. The compact wide table is only shown on `md+` screens.
 */
function MemberCard({ member, index, error = {}, onUpdate, onRemove, canRemove }) {
  const optionsFor = (key) => {
    if (key === "relationship")
      return (
        <>
          <option value="">Select...</option>
          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
        </>
      );
    if (key === "sex")
      return (
        <>
          <option value="">Select...</option>
          {SEX_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </>
      );
    if (key === "classification")
      return (
        <>
          <option value="">Select...</option>
          {CLASSIFICATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </>
      );
    return null;
  };

  const field = "block text-sm font-medium text-brand-ink";
  const input = inputCls();
  const inputErr = inputCls("x");
  const threeCol = "grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3";

  const quarterSel = (q) => (
    <select value={member[q]} onChange={(e) => onUpdate(q, e.target.value)} className={`${input} cursor-pointer`}>
      <option value="">{q.toUpperCase()}</option>
      {QUARTER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );

  return (
    <div className="rounded-btn border border-brand-border bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-dashed border-brand-border pb-2.5">
        <p className="text-sm font-semibold text-brand-ink">Member {index + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="flex h-9 w-9 items-center justify-center rounded-btn border border-brand-border text-brand-gray transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Remove member ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className={`${field} mb-1.5`}>Name {error.name && <span className="text-red-600">*</span>}</label>
          <input type="text" value={member.name} onChange={(e) => onUpdate("name", e.target.value)} placeholder="Member name" className={error.name ? inputErr : input} />
          {error.name && <p className="mt-1 text-xs text-red-600">{error.name}</p>}
        </div>

        <div className={threeCol}>
          <div>
            <label className={`${field} mb-1.5`}>Relationship {error.relationship && <span className="text-red-600">*</span>}</label>
            <select value={member.relationship} onChange={(e) => onUpdate("relationship", e.target.value)} className={`${error.relationship ? inputErr : input} cursor-pointer`}>
              {optionsFor("relationship")}
            </select>
            {error.relationship && <p className="mt-1 text-xs text-red-600">{error.relationship}</p>}
          </div>
          <div>
            <label className={`${field} mb-1.5`}>Sex {error.sex && <span className="text-red-600">*</span>}</label>
            <select value={member.sex} onChange={(e) => onUpdate("sex", e.target.value)} className={`${error.sex ? inputErr : input} cursor-pointer`}>
              {optionsFor("sex")}
            </select>
            {error.sex && <p className="mt-1 text-xs text-red-600">{error.sex}</p>}
          </div>
          <div>
            <label className={`${field} mb-1.5`}>Age</label>
            <input type="number" min="0" value={member.age} onChange={(e) => onUpdate("age", e.target.value)} placeholder="—" className={input} />
          </div>
        </div>

        <div className={threeCol}>
          <div>
            <label className={`${field} mb-1.5`}>Birthday</label>
            <input type="date" value={member.birthday} onChange={(e) => onUpdate("birthday", e.target.value)} className={input} />
          </div>
          <div>
            <label className={`${field} mb-1.5`}>Classification</label>
            <select value={member.classification} onChange={(e) => onUpdate("classification", e.target.value)} className={`${input} cursor-pointer`}>
              {optionsFor("classification")}
            </select>
          </div>
          <div>
            <label className={`${field} mb-1.5`}>PhilHealth</label>
            <select value={member.philhealth} onChange={(e) => onUpdate("philhealth", e.target.value)} className={`${input} cursor-pointer`}>
              <option value="">Unspecified</option>
              <option value="member">Member</option>
              <option value="non-member">Non-member</option>
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
          <input type="checkbox" checked={member.pwd} onChange={(e) => onUpdate("pwd", e.target.checked)} className="h-4 w-4 accent-brand-blue" />
          Person with disability (PWD)
        </label>

        <div>
          <label className={`${field} mb-1.5`}>Quarterly Visit Status</label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {["q1", "q2", "q3", "q4"].map((q) => <div key={q}>{quarterSel(q)}</div>)}
          </div>
        </div>

        <div>
          <label className={`${field} mb-1.5`}>Family Planning Method</label>
          <select value={member.fpMethod} onChange={(e) => onUpdate("fpMethod", e.target.value)} className={`${input} cursor-pointer`}>
            {FP_METHODS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div>
          <label className={`${field} mb-1.5`}>Remarks</label>
          <input type="text" value={member.remarks} onChange={(e) => onUpdate("remarks", e.target.value)} placeholder="—" className={input} />
        </div>
      </div>
    </div>
  );
}

function Section({ id, index, title, subtitle = "", open, onToggle, right = null, children }) {
  return (
    <Card className="overflow-hidden">
      <div
        className={`flex w-full items-center justify-between gap-3 bg-brand-bg/70 px-4 py-3 sm:px-5 ${
          open ? "border-b border-brand-border" : ""
        }`}
      >
        <button type="button" onClick={() => onToggle(id)} className="flex flex-1 items-center gap-3 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-blue text-[11px] font-bold text-white">
            {index}
          </span>
          <span>
            <span className="block text-sm font-semibold text-brand-ink sm:text-base">{title}</span>
            {subtitle && <span className="block text-xs text-brand-gray">{subtitle}</span>}
          </span>
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
      {open && <div className="p-4 sm:p-5 md:p-6">{children}</div>}
    </Card>
  );
}

/* Section a field belongs to, used to auto-expand the card that needs fixing. */
const FIELD_SECTIONS = {
  head: "info",
  purok: "info",
  streetAddress: "info",
  families: "details",
  respLast: "respondent",
  respFirst: "respondent",
  respMaiden: "respondent",
  waterSource: "water",
  toilet: "water",
};

const SECTION_INDEX = {
  info: 1,
  details: 2,
  respondent: 3,
  visits: 4,
  philhealth: 5,
  water: 6,
  members: 7,
  risk: 8,
};

/**
 * Add New Household — dedicated full-page workflow.
 *
 * Replaces the previous right-side drawer with a routed page (`households/new`)
 * that renders in the normal application shell. All fields, validations, the
 * live risk classification and the offline "Pending Sync" behavior are kept
 * from the original implementation; only the container changed.
 */
export default function AddHouseholdPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const householdList = useHouseholds();
  const syncStatus = useHouseholdSyncStatus();

  // Absolute path to the Household Profiling list for the current role area
  // (e.g. /app/bhw/households or /app/health_supervisor/households). Relative
  // ".." cannot be used here: `households/new` is a sibling route of the app
  // layout, so React Router resolves ".." to the layout path and its index
  // route silently redirects to the Dashboard.
  const householdsPath = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("households");
    return idx >= 0 ? `/${parts.slice(0, idx + 1).join("/")}` : null;
  }, [location.pathname]);

  const defaultCollector =
    user?.role === "bhw" && user?.name ? user.name : ACTIVE_BHWS[0] || "Maria Cruz";
  const bhwOptions = bhwOptionsFor(defaultCollector);
  const householdId = householdStore.nextId(householdList);
  const offline = syncStatus !== "connected";

  const [openSections, setOpenSections] = useState({
    info: true,
    details: true,
    respondent: true,
    visits: false,
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

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

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

  const addMember = () => setForm((prev) => ({ ...prev, members: [...prev.members, emptyMember()] }));

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
      philhealth: form.phMember === "Yes" ? { id: form.phId.trim(), category: form.phCategory } : null,
      riskScore: computed.score,
      riskLevel: computed.level,
      riskFactors: computed.factors,
      flags: autoFlags,
      concerns: [...new Set([...autoFlags, ...computed.factors])],
      // Offline/local saving is preserved: households saved while offline are
      // tagged "Pending Sync" and queued for the next synchronization.
      syncStatus: offline ? "Pending Sync" : null,
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
    householdStore.addHousehold(buildHousehold());
    if (householdsPath) {
      navigate(householdsPath, { replace: true, state: { hhToast: `Household ${householdId} added successfully` } });
    }
  };

  const grid2 = "grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2";

  return (
    <>
      {/* Page header */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-card md:mb-8 md:px-6 md:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Desktop: breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 md:flex"
          >
            {householdsPath && (
              <Link
                to={householdsPath}
                className="inline-flex items-center transition-colors hover:text-brand-blue"
              >
                Household Profiling
              </Link>
            )}
            <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
            <span className="text-brand-blue">Add Household</span>
          </nav>
          {/* Mobile: compact back link */}
          {householdsPath && (
            <Link
              to={householdsPath}
              className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-blue transition-colors hover:text-brand-dark md:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Household Profiling
            </Link>
          )}
          {!offline && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 md:ml-0">
              <CheckCircle2 className="h-3.5 w-3.5" /> Online — will sync immediately
            </span>
          )}
        </div>
        <div className="mt-2 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light">
            <Home className="h-5 w-5 text-brand-blue" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Add New Household
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Register a new household and record its basic information.
            </p>
          </div>
        </div>
      </div>

      {/* Form body — fills the content area; two columns on md+ */}
      <div className="w-full space-y-5 pb-6">
        {/* 1 — Household Information */}
        <Section
          id="info"
          index={SECTION_INDEX.info}
          title="Household Information"
          subtitle="Identify the household head and location."
          open={openSections.info}
          onToggle={toggleSection}
        >
          <div className={grid2}>
            <Field label="Household ID" hint="Auto-generated, read-only">
              <input readOnly value={householdId} className={readOnlyCls} />
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
            <Field label="Last Updated" hint="Auto date, read-only">
              <input readOnly value={today()} className={readOnlyCls} />
            </Field>
          </div>
        </Section>

        {/* 2 — Household Details */}
        <Section
          id="details"
          index={SECTION_INDEX.details}
          title="Household Details"
          subtitle="Families, income, collector assignment and status."
          open={openSections.details}
          onToggle={toggleSection}
        >
          <div className={grid2}>
            <Field label="Number of Families in the Household" required error={errors.families} hint="A household can have more than one family">
              <input
                type="number"
                min="1"
                value={form.families}
                onChange={(e) => set("families", e.target.value)}
                className={inputCls(errors.families)}
              />
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
            <Field label="Assigned Data Collector / BHW" hint="Auto-filled with the logged-in user — editable">
              <select value={form.collector} onChange={(e) => set("collector", e.target.value)} className={`${inputCls()} cursor-pointer`}>
                {bhwOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
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
          </div>
        </Section>

        {/* 3 — Respondent Information */}
        <Section
          id="respondent"
          index={SECTION_INDEX.respondent}
          title="Respondent Information"
          subtitle="Who provided the household details."
          open={openSections.respondent}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-3">
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
          <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
            <Field label="NHTS Household Status">
              <RadioRow name="nhts" value={form.nhts} onChange={(v) => set("nhts", v)} options={["NHTS-4Ps", "NHTS Non-4Ps", "Non-NHTS"]} />
            </Field>
            <Field label="Indigenous People Status">
              <RadioRow name="ip" value={form.ip} onChange={(v) => set("ip", v)} options={["IP", "Non-IP"]} />
            </Field>
          </div>
        </Section>

        {/* 4 — Visit Tracking */}
        <Section
          id="visits"
          index={SECTION_INDEX.visits}
          title="Visit Tracking"
          subtitle="Quarterly visit dates (optional)."
          open={openSections.visits}
          onToggle={toggleSection}
        >
          <div className={grid2}>
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

        {/* 5 — HH Head PhilHealth Info */}
        <Section
          id="philhealth"
          index={SECTION_INDEX.philhealth}
          title="HH Head PhilHealth Info"
          subtitle="Optional PhilHealth membership details."
          open={openSections.philhealth}
          onToggle={toggleSection}
        >
          <Field label="PhilHealth Member?">
            <RadioRow name="phMember" value={form.phMember} onChange={(v) => set("phMember", v)} options={["No", "Yes"]} />
          </Field>
          {form.phMember === "Yes" && (
            <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
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

        {/* 6 — Water Source & Sanitation Details */}
        <Section
          id="water"
          index={SECTION_INDEX.water}
          title="Water Source & Sanitation Details"
          subtitle="Facilities used by the household."
          open={openSections.water}
          onToggle={toggleSection}
        >
          <div className={grid2}>
            <Field label="Primary Water Source" required error={errors.waterSource} className="md:col-span-2">
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
            <Field label="Water Treatment Practiced at Home?" className="md:col-span-2">
              <RadioRow name="treatWater" value={form.treatWater} onChange={(v) => set("treatWater", v)} options={["Yes", "No"]} />
            </Field>
            {form.treatWater === "Yes" && (
              <div className="md:col-span-2">
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

        {/* 7 — Household Members */}
        <Section
          id="members"
          index={SECTION_INDEX.members}
          title="Household Members"
          subtitle="All individuals living in the household."
          open={openSections.members}
          onToggle={toggleSection}
          right={
            <div className="group relative">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-blue"
                  aria-label="Classification legend"
                >
                  <Info className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Classification legend</span>
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
          <div className="hidden overflow-x-auto rounded-btn border border-brand-border bg-white lg:block">
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

          {/* Mobile/tablet member cards */}
          <div className="space-y-4 lg:hidden">
            {form.members.map((m, i) => (
              <MemberCard
                key={i}
                member={m}
                index={i}
                error={memberErrors[i] || {}}
                onUpdate={(key, value) => updateMember(i, key, value)}
                onRemove={() => removeMember(i)}
                canRemove={form.members.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addMember}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-brand-border bg-white py-2.5 text-sm font-medium text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-light"
          >
            <Plus className="h-4 w-4" /> Add Member
          </button>
        </Section>

        {/* 8 — Auto-Calculated Risk Classification */}
        <Section
          id="risk"
          index={SECTION_INDEX.risk}
          title="Auto-Calculated Risk Classification"
          subtitle="Updates live as you fill in the form."
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

        {/* Actions */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-brand-gray">
              <CloudOff className="h-3.5 w-3.5 shrink-0" />
              Saved locally when offline — tagged "Pending Sync" and queued automatically.
            </p>
            <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Link
                to={householdsPath || "."}
                className="inline-flex items-center justify-center rounded-btn border border-brand-border bg-white px-6 py-3 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg sm:py-2.5"
              >
                Cancel
              </Link>
              <button
                onClick={handleSave}
                className="inline-flex items-center justify-center rounded-btn bg-brand-blue px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-dark sm:py-2.5"
              >
                Save Household
              </button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
