import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import SearchableSelect from "@/components/common/SearchableSelect";
import { intakeApi } from "@/services/api";
import { CHECKUP_STATUS, useWorkflowStore, sendToPhnQueue } from "@/services/local/workflowStore";
import { BARANGAYS } from "@/lib/barangays";
import { barangayHealthCenter } from "@/lib/consultationLocations";
import { useAuth } from "@/context/AuthContext";
import MedicalCertificateModal from "@/features/certificates/components/MedicalCertificateModal";
import {
  ArrowLeft,
  Search,
  Send,
  Users,
  Plus,
  Check,
  MapPin,
  Stethoscope,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";

/* Minimum characters before the resident search shows results. */
const MIN_SEARCH_LENGTH = 2;

/* Plain-language reasons. The stored value stays compatible with the existing
 * workflow (reason / chiefComplaint is free text). */
const REASON_OPTIONS = [
  "Check-up",
  "Follow-up",
  "Prenatal care",
  "Child health",
  "Immunization",
  "Blood pressure check",
  "Fever or illness",
  "Other",
];

const STATUS_META = {
  [CHECKUP_STATUS.WAITING]: { text: "Waiting for PHN", note: "Not seen yet" },
  [CHECKUP_STATUS.IN_CHECKUP]: { text: "In Check-up", note: "With the PHN now" },
  [CHECKUP_STATUS.COMPLETED]: { text: "Consultation Completed", note: "Check-up done" },
};

const STATUS_TONES = {
  [CHECKUP_STATUS.WAITING]: "bg-brand-accent/10 text-brand-accent",
  [CHECKUP_STATUS.IN_CHECKUP]: "bg-brand-blue/10 text-brand-blue",
  [CHECKUP_STATUS.COMPLETED]: "bg-brand-green/10 text-brand-green",
};

const ROW_COLS = "md:grid-cols-[2.2fr_1fr_1.6fr_1.2fr_auto]";

/* Workflow steps (0-indexed progress). */
const STEP_ORDER = ["patient", "vitals", "reason", "location", "review"];
const STEP_LABELS = {
  patient: "Patient",
  vitals: "Vital Signs",
  reason: "Reason for Visit",
  location: "Location",
  review: "Review",
};

/** Vital sign draft. BMI is computed, never stored for manual input. */
const emptyVitals = () => ({
  heightCm: "",
  weightKg: "",
  bloodPressure: "",
  bloodSugar: "",
});

/** BMI = weight(kg) / (height(m))². Returns "" when inputs are missing/invalid.
 *  Preview only: the backend (utils/bmi.js) recomputes and persists the
 *  authoritative value at 1-decimal precision, so this preview uses the SAME
 *  rounding to avoid a frontend/backend mismatch. Never defaults missing
 *  height/weight to 0. */
const computeBmi = (heightCm, weightKg) => {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!heightCm || !weightKg || Number.isNaN(h) || Number.isNaN(w) || h <= 0 || w <= 0) {
    return { value: "", raw: null };
  }
  const hM = h / 100;
  const rounded = Math.round((w / (hM * hM)) * 10) / 10;
  return { value: rounded.toFixed(1), raw: rounded };
};

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const metaLine = (age, sex, barangay) =>
  [age ? `${age} years old` : null, sex, barangay || "RHU"].filter(Boolean).join(" â€¢ ");

const numeric = (value) => (value !== "" && value != null && !Number.isNaN(Number(value)) ? Number(value) : null);

export default function RhuTriage() {
  const { user } = useAuth();
  const store = useWorkflowStore();

  /* --------------------------- Workflow state --------------------------- */
  const [currentStep, setCurrentStep] = useState("patient"); // see STEP_ORDER

  // Patient selection state.
  const [searchQuery, setSearchQuery] = useState("");
  // "choose" (pick how to identify the patient) | "search" | "walkin"
  const [entryMode, setEntryMode] = useState("choose");
  const [patientType, setPatientType] = useState(null); // null | "registered" | "walkin"
  const [selected, setSelected] = useState(null); // registered resident object (real record only)
  const [walkIn, setWalkIn] = useState({ name: "", age: "", sex: "Female", barangay: "" }); // walk-in draft

  // Remaining triage sections (kept in state so Back/Continue never lose data).
  const [vitals, setVitals] = useState(emptyVitals);
  const [reason, setReason] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [listSearch, setListSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [certPatient, setCertPatient] = useState(null); // patient being certified

  // Registered-patient search is backed by the REAL resident directory
  // (GET /api/intake/residents/search), barangay/municipality-scoped on the
  // server. There is no local resident registry: a "registered" patient always
  // carries a real residents.id resolved from the backend.
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  const sentPatients = store.patients;

  const visibleHistory = useMemo(
    () =>
      sentPatients.filter((p) => {
        const q = listSearch.trim().toLowerCase();
        if (!q) return true;
        return (
          p.patient.toLowerCase().includes(q) ||
          (p.barangay || "RHU").toLowerCase().includes(q)
        );
      }),
    [sentPatients, listSearch]
  );

  // Live filter over actual resident records. Typed text is never a patient.
  const trimmedQuery = searchQuery.trim();
  const shouldSearch = trimmedQuery.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!shouldSearch) {
      setMatches([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await intakeApi.searchResidents(trimmedQuery);
        if (cancelled) return;
        const mapped = rows
          .map((r) => ({
            id: r.id,
            name:
              [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() ||
              r.name ||
              "",
            age: r.birthDate
              ? Math.max(0, new Date().getFullYear() - new Date(r.birthDate).getFullYear())
              : r.age ?? "",
            sex: r.sex || "",
            barangay: r.barangay || "",
          }))
          .filter((r) => r.name)
          .slice(0, 8);
        setMatches(mapped);
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, shouldSearch]);

  /* --------------------- Derived patient identity ---------------------- */
  const hasPatient = patientType !== null;
  const patientName = patientType === "registered"
    ? selected?.name || ""
    : patientType === "walkin"
      ? walkIn.name
      : "";
  const patientAge = patientType === "registered"
    ? selected?.age ?? ""
    : patientType === "walkin"
      ? walkIn.age
      : "";
  const patientSex = patientType === "registered"
    ? selected?.sex || ""
    : patientType === "walkin"
      ? walkIn.sex
      : "";
  const patientBarangay = patientType === "registered"
    ? selected?.barangay || ""
    : patientType === "walkin"
      ? walkIn.barangay || ""
      : "";

  const bmi = computeBmi(vitals.heightCm, vitals.weightKg);
  const finalReason = reason === "Other" ? reasonDetail.trim() : reason.trim();

  const locationOptions = useMemo(() => {
    if (!patientBarangay) return [{ value: "RHU", label: "At the RHU" }];
    return [
      { value: "RHU", label: "At the RHU" },
      {
        value: barangayHealthCenter(patientBarangay),
        label: `At the Barangay (${patientBarangay})`,
      },
    ];
  }, [patientBarangay]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  const resetAll = () => {
    setCurrentStep("patient");
    setPatientType(null);
    setSelected(null);
    setWalkIn({ name: "", age: "", sex: "Female", barangay: "" });
    setSearchQuery("");
    setEntryMode("choose");
    setVitals(emptyVitals());
    setReason("");
    setReasonDetail("");
    setLocation("");
    setNotes("");
    setErrors({});
  };

  /* --------------------------- Patient handlers ------------------------- */
  const chooseRegistered = (resident) => {
    if (!resident) return;
    setPatientType("registered");
    setSelected(resident);
    setSearchQuery("");
    setWalkIn({ name: "", age: "", sex: "Female", barangay: "" });
    setErrors({});
  };

  const startSearch = () => {
    setEntryMode("search");
    setErrors({});
  };

  const openWalkIn = () => {
    setPatientType(null);
    setEntryMode("walkin");
    setErrors({});
  };

  const backToChoices = () => {
    setEntryMode("choose");
    setSearchQuery("");
    setErrors({});
  };

  const changePatient = () => {
    setPatientType(null);
    setSelected(null);
    setWalkIn({ name: "", age: "", sex: "Female", barangay: "" });
    setEntryMode("choose");
    setSearchQuery("");
    setErrors({});
  };

  /* ----------------------------- Validation ----------------------------- */
  const validateRegisteredPatient = () => {
    const next = {};
    if (!selected) next.patient = "Please select a patient first.";
    return next;
  };

  const validateWalkInFields = () => {
    const next = {};
    if (!walkIn.name.trim()) next.name = "Please enter the patient's name.";
    if (!walkIn.barangay) next.barangay = "Please choose the patient's barangay.";
    return next;
  };

  const validatePatient = () => {
    if (patientType === "walkin") return validateWalkInFields();
    return validateRegisteredPatient();
  };

  const validateVitals = () => {
    const next = {};
    if (!vitals.heightCm) next.heightCm = "Please enter the patient's height.";
    else if (!(Number(vitals.heightCm) > 0)) next.heightCm = "Please enter a valid height.";
    if (!vitals.weightKg) next.weightKg = "Please enter the patient's weight.";
    else if (!(Number(vitals.weightKg) > 0)) next.weightKg = "Please enter a valid weight.";
    if (!vitals.bloodPressure) next.bloodPressure = "Please enter the patient's blood pressure.";
    else if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(vitals.bloodPressure.trim())) {
      next.bloodPressure = "Use the format 120/80.";
    }
    if (!vitals.bloodSugar) next.bloodSugar = "Please enter the patient's blood sugar.";
    else if (!(Number(vitals.bloodSugar) > 0)) next.bloodSugar = "Please enter a valid blood sugar.";
    return next;
  };

  /* ------------------------- Continue / Back logic ---------------------- */
  const continueFromPatient = () => {
    const nextErrors = validatePatient();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setCurrentStep("vitals");
  };

  const continueFromVitals = () => {
    const nextErrors = validateVitals();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setCurrentStep("reason");
  };

  const continueFromReason = () => {
    if (reason === "Other" && !reasonDetail.trim()) {
      setErrors({ reasonDetail: "Please describe the reason." });
      return;
    }
    setErrors({});
    setCurrentStep("location");
  };

  const continueFromLocation = () => {
    if (!location) {
      setErrors({ location: "Please choose where the patient will be seen." });
      return;
    }
    setErrors({});
    setCurrentStep("review");
  };

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) {
      setCurrentStep(STEP_ORDER[idx - 1]);
      setErrors({});
    }
  };

  /* ----------------------------- Final action --------------------------- */
  const handleSendToPhn = () => {
    const payload = {
      // Registered patients carry their real residents.id (from the backend
      // search); walk-ins have none until they are created through intake.
      residentId: patientType === "registered" ? selected?.id || null : null,
      patient: patientName,
      age: numeric(patientAge),
      sex: patientSex,
      barangay: patientBarangay || null,
      reason: finalReason,
      chiefComplaint: finalReason,
      // Measurements collected during triage.
      temperature: null,
      bloodPressure: vitals.bloodPressure.trim() || null,
      pulseRate: null,
      respiratoryRate: null,
      oxygenSaturation: null,
      weight: vitals.weightKg ? String(vitals.weightKg) : null,
      heightCm: vitals.heightCm ? String(vitals.heightCm) : null,
      bmi: bmi.value || null,
      bloodSugar: vitals.bloodSugar.trim() || null,
      notes: notes.trim(),
      consultationLocation: location || "RHU",
      personnel: user?.name || "RHU Personnel",
      visitDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    };
    sendToPhnQueue(payload);
    resetAll();
    showToast("Patient successfully sent to PHN.");
  };

  /* ------------------------------ UI helpers ---------------------------- */
  const stepIndicator = (number, title, hint) => (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-blue text-[11px] font-bold text-white">
        {number}
      </span>
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink">{title}</h4>
        {hint && <p className="mt-0.5 text-xs font-normal normal-case tracking-normal text-brand-gray">{hint}</p>}
      </div>
    </div>
  );

  const stepIndex = STEP_ORDER.indexOf(currentStep);

  const progress = (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {STEP_ORDER.map((s, i) => {
        const active = s === currentStep;
        const done = i < stepIndex;
        return (
          <div key={s} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 bg-brand-border sm:w-5" />}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                active
                  ? "bg-brand-blue text-white"
                  : done
                    ? "bg-brand-light text-brand-blue"
                    : "bg-brand-bg text-brand-gray"
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : <span>{i + 1}.</span>}
              <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
            </span>
          </div>
        );
      })}
    </div>
  );

  const backContinue = (onContinue, continueLabel = "Continue") => (
    <div className="mt-6 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={goBack}
        disabled={stepIndex === 0}
        className="inline-flex items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-brand-blue px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
      >
        {continueLabel} <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={["RHU", "Triage"]}
        title="RHU Triage"
        subtitle="Record a patient's visit and send them to the PHN for check-up."
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg animate-in slide-in-from-bottom-2">
          <Check className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Single column â€” fills the application content area */}
      <div className="w-full space-y-5 sm:space-y-6">
        {/* ============ NEW TRIAGE ============ */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-brand-border/70 px-4 py-4 sm:px-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
              <Stethoscope className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-brand-ink">New Triage</h3>
              <p className="mt-0.5 text-xs text-brand-gray">
                First identify the patient, record today's visit, then send them to the PHN.
              </p>
            </div>
          </div>

          <div className="px-4 py-5 sm:px-6 sm:py-6">
            {hasPatient && progress}

            {/* ============ STEP 1 Â· PATIENT ============ */}
            {currentStep === "patient" && (
              <div>
                {!hasPatient ? (
                  <>
                    {stepIndicator(1, "Identify Patient", "Who are you helping today?")}

                    {entryMode === "choose" ? (
                      /* Two clear ways to identify the patient. */
                      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={startSearch}
                          className="group flex flex-col items-start gap-2 rounded-btn border-2 border-brand-border bg-white p-4 text-left transition-colors hover:border-brand-blue"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
                            <Search className="h-5 w-5" />
                          </span>
                          <span className="text-sm font-semibold text-brand-ink">Search Existing Patient</span>
                          <span className="text-xs text-brand-gray">
                            Find a resident already registered in KALUSAGAP.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={openWalkIn}
                          className="group flex flex-col items-start gap-2 rounded-btn border-2 border-brand-border bg-white p-4 text-left transition-colors hover:border-brand-blue"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
                            <Plus className="h-5 w-5" />
                          </span>
                          <span className="text-sm font-semibold text-brand-ink">Register Walk-in Patient</span>
                          <span className="text-xs text-brand-gray">
                            For patients who do not yet have an existing record.
                          </span>
                        </button>
                      </div>
                    ) : entryMode === "walkin" ? (
                      <div className="space-y-4">
                        <div className="max-w-xl rounded-btn border border-brand-blue/20 bg-brand-blue/5 px-4 py-3">
                          <p className="text-sm font-semibold text-brand-ink">Walk-in Patient Information</p>
                          <p className="mt-0.5 text-xs text-brand-gray">
                            This information will be used to record today's RHU visit.
                          </p>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                            Patient Name <span className="text-brand-danger">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Enter patient's name"
                            value={walkIn.name}
                            onChange={(e) => setWalkIn((prev) => ({ ...prev, name: e.target.value }))}
                            className={inputCls(errors.name)}
                          />
                          {errors.name && <p className="mt-1 text-xs text-brand-danger">{errors.name}</p>}
                        </div>
                        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-brand-ink">Age *</label>
                            <input
                              type="number"
                              min="0"
                              placeholder="e.g. 34"
                              value={walkIn.age}
                              onChange={(e) => setWalkIn((prev) => ({ ...prev, age: e.target.value }))}
                              className={inputCls()}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-brand-ink">Sex *</label>
                            <div className="relative">
                              <select
                                value={walkIn.sex}
                                onChange={(e) => setWalkIn((prev) => ({ ...prev, sex: e.target.value }))}
                                className={`${inputCls()} cursor-pointer appearance-none pr-9`}
                              >
                                <option>Female</option>
                                <option>Male</option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
                            </div>
                          </div>
                        </div>
                        <div className="max-w-xl">
                          <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                            Barangay <span className="text-brand-danger">*</span>
                          </label>
                          <SearchableSelect
                            value={walkIn.barangay}
                            onChange={(v) => setWalkIn((prev) => ({ ...prev, barangay: v }))}
                            options={BARANGAYS}
                            placeholder="Search barangay..."
                            emptyText="No barangay found."
                            error={errors.barangay}
                          />
                        </div>
                        <div className="flex flex-col-reverse items-stretch gap-3 pt-1 sm:max-w-xl sm:flex-row sm:items-center sm:justify-between">
                          <button
                            type="button"
                            onClick={backToChoices}
                            className="inline-flex items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:text-brand-ink"
                          >
                            <ArrowLeft className="h-4 w-4" /> Back
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = validateWalkInFields();
                              setErrors(next);
                              if (Object.keys(next).length === 0) setPatientType("walkin");
                            }}
                            className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                          >
                            Continue <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Registered resident search */
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-brand-ink">Search Existing Patient</p>
                            <p className="mt-0.5 text-xs text-brand-gray">
                              Find a resident already registered in KALUSAGAP by name.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={backToChoices}
                            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-gray hover:text-brand-ink"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" /> Back
                          </button>
                        </div>
                        <div className="flex max-w-2xl items-center gap-2 rounded-btn border border-brand-border bg-white px-3.5 py-3 focus-within:border-brand-blue">
                          <Search className="h-4 w-4 shrink-0 text-brand-gray" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search for a registered patient..."
                            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70"
                          />
                        </div>

                        {trimmedQuery && (
                          <div className="mt-2 max-w-2xl overflow-hidden rounded-btn border border-brand-border bg-white">
                            {trimmedQuery.length < MIN_SEARCH_LENGTH ? (
                              <p className="px-4 py-3 text-sm text-brand-gray">Keep typing to search for a patient.</p>
                            ) : searching ? (
                              <p className="px-4 py-3 text-sm text-brand-gray">Searching…</p>
                            ) : matches.length > 0 ? (
                              <ul>
                                {matches.map((r) => (
                                  <li key={r.id}>
                                    <button
                                      type="button"
                                      onClick={() => chooseRegistered(r)}
                                      className="flex w-full items-center justify-between gap-3 border-b border-brand-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-brand-light"
                                    >
                                      <span className="flex min-w-0 items-center gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-blue">
                                          <Users className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block truncate text-sm font-semibold text-brand-ink">{r.name}</span>
                                          <span className="block text-xs text-brand-gray">
                                            {metaLine(r.age, r.sex, r.barangay)}
                                          </span>
                                        </span>
                                      </span>
                                      <span className="text-xs font-medium text-brand-blue">Select</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="px-4 py-3">
                                <p className="text-sm text-brand-gray">
                                  No registered patient found for “{trimmedQuery}”.
                                </p>
                                <button
                                  type="button"
                                  onClick={openWalkIn}
                                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                                >
                                  <Plus className="h-4 w-4" /> Register as a walk-in patient instead
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* Selected patient summary (registered or confirmed walk-in) */
                  <>
                    {stepIndicator(1, "Identify Patient", "Confirm the patient before continuing to triage.")}
                    <div className="max-w-2xl rounded-btn border border-emerald-200 bg-emerald-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <Check className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                              {patientType === "registered" ? "Registered Patient" : "Walk-in Patient"}
                            </p>
                            <p className="truncate text-sm font-semibold text-brand-ink sm:text-base">{patientName}</p>
                            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-brand-gray sm:grid-cols-3">
                              {patientType === "registered" && (
                                <div className="col-span-2 sm:col-span-3">
                                  <dt className="inline text-brand-gray">Patient ID: </dt>
                                  <dd className="inline font-medium text-brand-ink">{selected?.id || "—"}</dd>
                                </div>
                              )}
                              <div>
                                <dt className="text-brand-gray">Age</dt>
                                <dd className="font-medium text-brand-ink">{patientAge !== "" && patientAge != null ? `${patientAge}` : "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-brand-gray">Sex</dt>
                                <dd className="font-medium text-brand-ink">{patientSex || "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-brand-gray">Barangay</dt>
                                <dd className="font-medium text-brand-ink">{patientBarangay || "—"}</dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={changePatient}
                          className="shrink-0 rounded-btn border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                        >
                          Change patient
                        </button>
                      </div>
                    </div>

                    {errors.patient && <p className="mt-2 text-xs text-brand-danger">{errors.patient}</p>}
                    {backContinue(continueFromPatient, "Continue to Triage")}
                  </>
                )}
              </div>
            )}

            {/* ============ STEP 2 Â· VITAL SIGNS & MEASUREMENTS ============ */}
            {currentStep === "vitals" && (
              <div>
                {stepIndicator(
                  2,
                  "Vital Signs & Measurements",
                  "Record the patient's measurements before the check-up."
                )}

                <div className="max-w-2xl space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">Height *</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          placeholder="e.g. 170"
                          value={vitals.heightCm}
                          onChange={(e) => setVitals((prev) => ({ ...prev, heightCm: e.target.value }))}
                          className={`${inputCls(errors.heightCm)} pr-12`}
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-brand-gray">
                          cm
                        </span>
                      </div>
                      {errors.heightCm && <p className="mt-1 text-xs text-brand-danger">{errors.heightCm}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">Weight *</label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          placeholder="e.g. 65"
                          value={vitals.weightKg}
                          onChange={(e) => setVitals((prev) => ({ ...prev, weightKg: e.target.value }))}
                          className={`${inputCls(errors.weightKg)} pr-12`}
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-brand-gray">
                          kg
                        </span>
                      </div>
                      {errors.weightKg && <p className="mt-1 text-xs text-brand-danger">{errors.weightKg}</p>}
                    </div>
                  </div>

                  {/* Auto-computed BMI */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-brand-ink">BMI</label>
                    <div className="flex items-center gap-3 rounded-btn border border-dashed border-brand-blue/40 bg-brand-blue/5 px-3.5 py-2.5">
                      <span className="text-lg font-semibold text-brand-blue">{bmi.value || "â€”"}</span>
                      <span className="text-xs text-brand-gray">
                        {bmi.value
                          ? "Auto-computed from height and weight"
                          : "Enter height and weight to compute automatically"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                        Blood Pressure * <span className="font-normal text-brand-gray">(mmHg)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 120/80"
                        value={vitals.bloodPressure}
                        onChange={(e) => setVitals((prev) => ({ ...prev, bloodPressure: e.target.value }))}
                        className={inputCls(errors.bloodPressure)}
                      />
                      {errors.bloodPressure && <p className="mt-1 text-xs text-brand-danger">{errors.bloodPressure}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                        Blood Sugar * <span className="font-normal text-brand-gray">(mg/dL)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 100"
                        value={vitals.bloodSugar}
                        onChange={(e) => setVitals((prev) => ({ ...prev, bloodSugar: e.target.value }))}
                        className={inputCls(errors.bloodSugar)}
                      />
                      {errors.bloodSugar && <p className="mt-1 text-xs text-brand-danger">{errors.bloodSugar}</p>}
                    </div>
                  </div>
                </div>

                {backContinue(continueFromVitals)}
              </div>
            )}

            {/* ============ STEP 3 Â· REASON FOR VISIT ============ */}
            {currentStep === "reason" && (
              <div>
                {stepIndicator(3, "Reason for Visit", "Why is the patient here today?")}

                <div className="flex max-w-2xl flex-wrap gap-2">
                  {REASON_OPTIONS.map((opt) => {
                    const active = reason === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setReason(opt)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                          active
                            ? "border-brand-blue bg-brand-blue/10 font-medium text-brand-ink"
                            : "border-brand-border bg-white text-brand-gray hover:border-brand-blue"
                        }`}
                      >
                        {active && <Check className="h-3.5 w-3.5 text-brand-blue" />}
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {reason === "Other" && (
                  <div className="mt-3 max-w-2xl">
                    <label className="mb-1.5 block text-sm font-medium text-brand-ink">Describe the reason:</label>
                    <input
                      type="text"
                      placeholder="e.g. fever for 2 days..."
                      value={reasonDetail}
                      onChange={(e) => setReasonDetail(e.target.value)}
                      className={inputCls(errors.reasonDetail)}
                    />
                    {errors.reasonDetail && <p className="mt-1 text-xs text-brand-danger">{errors.reasonDetail}</p>}
                  </div>
                )}
                {errors.reason && <p className="mt-2 text-xs text-brand-danger">{errors.reason}</p>}

                {backContinue(continueFromReason)}
              </div>
            )}

            {/* ============ STEP 4 Â· LOCATION ============ */}
            {currentStep === "location" && (
              <div>
                {stepIndicator(4, "Location", "Where will the patient be seen?")}

                <div className="grid max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {locationOptions.map((opt) => {
                    const active = location === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setLocation(opt.value)}
                        className={`flex items-center gap-2.5 rounded-btn border-2 px-4 py-3 text-left transition-colors ${
                          active
                            ? "border-brand-blue bg-brand-blue/5 text-brand-ink"
                            : "border-brand-border bg-white text-brand-gray hover:border-brand-blue/60"
                        }`}
                      >
                        <MapPin className={`h-4 w-4 shrink-0 ${active ? "text-brand-blue" : "text-brand-gray"}`} />
                        <span className="text-sm font-medium">{opt.label}</span>
                        {active && <Check className="ml-auto h-4 w-4 text-brand-blue" />}
                      </button>
                    );
                  })}
                </div>
                {errors.location && <p className="mt-2 text-xs text-brand-danger">{errors.location}</p>}

                {backContinue(continueFromLocation)}
              </div>
            )}

            {/* ============ STEP 5 Â· REVIEW ============ */}
            {currentStep === "review" && (
              <div>
                {stepIndicator(5, "Review", "Check the details before sending the patient to the PHN.")}

                <div className="max-w-2xl space-y-3">
                  <div className="rounded-btn border border-brand-border bg-brand-bg/40 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Patient</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{patientName}</p>
                    <p className="text-xs text-brand-gray">{metaLine(patientAge, patientSex, patientBarangay)}</p>
                  </div>

                  <div className="rounded-btn border border-brand-border bg-brand-bg/40 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                      Vital Signs & Measurements
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-brand-gray">Height</p>
                        <p className="font-medium text-brand-ink">{vitals.heightCm ? `${vitals.heightCm} cm` : "â€”"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-brand-gray">Weight</p>
                        <p className="font-medium text-brand-ink">{vitals.weightKg ? `${vitals.weightKg} kg` : "â€”"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-brand-gray">BMI</p>
                        <p className="font-medium text-brand-blue">{bmi.value || "â€”"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-brand-gray">Blood Pressure</p>
                        <p className="font-medium text-brand-ink">{vitals.bloodPressure ? `${vitals.bloodPressure} mmHg` : "â€”"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-brand-gray">Blood Sugar</p>
                        <p className="font-medium text-brand-ink">{vitals.bloodSugar ? `${vitals.bloodSugar} mg/dL` : "â€”"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-btn border border-brand-border bg-brand-bg/40 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Reason for Visit</p>
                      <p className="mt-0.5 text-sm font-semibold text-brand-ink">{finalReason}</p>
                    </div>
                    <div className="rounded-btn border border-brand-border bg-brand-bg/40 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Location</p>
                      <p className="mt-0.5 text-sm font-semibold text-brand-ink">
                        {location === "RHU" ? "At the RHU" : `At the Barangay (${location.replace(" Barangay Health Center", "")})`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-5 py-3 text-sm font-medium text-brand-gray transition-colors hover:text-brand-ink sm:py-2.5"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSendToPhn}
                    className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                  >
                    <Send className="h-4 w-4" /> Send to PHN
                  </button>
                </div>
                <p className="mt-2 text-center text-xs text-brand-gray sm:text-left">
                  The patient will be added to the PHN's check-up queue.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* ============ RECENTLY SENT PATIENTS ============ */}
        <Card className="overflow-hidden">
          <div className="border-b border-brand-border/70 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-brand-ink">Recently Sent Patients</h3>
                <p className="mt-0.5 text-xs text-brand-gray">Patients recently sent for PHN check-up.</p>
              </div>
              <Users className="h-4 w-4 shrink-0 text-brand-gray" />
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg/60 px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" />
              <input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Search patients..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
              />
            </div>
          </div>

          {visibleHistory.length === 0 ? (
            <p className="py-8 text-center text-sm text-brand-gray">No patients have been sent yet.</p>
          ) : (
            <div>
              <div className={`hidden border-b border-brand-border px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray md:grid ${ROW_COLS}`}>
                <span>Patient</span>
                <span>Barangay</span>
                <span>Reason</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>

              <ul>
                {visibleHistory.map((p) => {
                  const meta = STATUS_META[p.status] || { text: p.status, note: "" };
                  return (
                    <li
                      key={p.id}
                      className={`grid grid-cols-1 gap-x-4 gap-y-1 border-b border-brand-border/60 px-4 py-3.5 last:border-0 md:items-center md:px-5 md:py-2.5 ${ROW_COLS}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-[11px] font-semibold text-brand-blue md:hidden">
                          {(p.patient || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-brand-ink">{p.patient}</p>
                          <p className="truncate text-xs text-brand-gray">{p.age ?? "â€”"} yrs â€¢ {p.sex}</p>
                        </div>
                      </div>
                      <div className="md:pr-3">
                        <span className="inline-flex rounded-full bg-brand-blue/10 px-2 py-0.5 text-xs font-medium text-brand-blue">
                          {p.barangay || "RHU"}
                        </span>
                      </div>
                      <p className="truncate text-xs leading-snug text-brand-ink md:text-sm md:pr-3">
                        {p.reason || p.triage?.chiefComplaint}
                      </p>
                      <div className="md:flex md:justify-end">
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[p.status] || "bg-slate-100 text-slate-600"}`}
                          title={meta.note}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                          {meta.text}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 md:justify-end">
                        <button
                          type="button"
                          onClick={() => setCertPatient(p)}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue dark:bg-card"
                        >
                          <FileText className="h-3.5 w-3.5" /> Medical Certificate
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Medical Certificate (prepared at triage, submitted for MHO review) */}
      {certPatient && (
        <MedicalCertificateModal
          mode="create"
          patient={{
            patientId: certPatient.residentId || String(certPatient.id),
            patient: certPatient.patient,
            age: certPatient.age ?? "",
            sex: certPatient.sex || "",
            barangay: certPatient.barangay || "RHU",
            address: certPatient.residenceBarangay || certPatient.barangay || "RHU",
          }}
          currentUser={user?.name || "RHU Personnel"}
          currentUserRole="RHU Personnel"
          onClose={() => setCertPatient(null)}
          onSaved={(status) => {
            showToast(`Medical certificate ${status === "For Review" ? "submitted for MHO review" : "saved as draft"}.`);
          }}
        />
      )}
    </>
  );
}
