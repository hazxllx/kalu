import React, { useEffect, useState } from "react";
import { X, CheckCircle2, Baby, Calendar } from "lucide-react";
import { Card } from "@/components/common/Card";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { ButtonSelectGroup as SelectButtonGroup } from "@/components/system";

const inputCls = (error) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 ${
    error ? "border-brand-danger" : "border-gray-300"
  }`;

const YES_NO = [
  { value: false, label: "No" },
  { value: true, label: "Yes" },
];

const RISK_LEVELS = ["Low", "Moderate", "High"];
const SES_OPTS = [
  { value: "", label: "Not Specified" },
  { value: "NHTS", label: "1 - NHTS" },
  { value: "Non-NHTS", label: "2 - Non-NHTS" },
];

/**
 * WorkflowSelector — Compact, elegant action selection modal
 * Replaces the oversized four-tab form with a simple two-action choice.
 */
function WorkflowSelector({ onSelectRegister, onSelectEncounter, onClose, residents, loading }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New maternal record workflow"
    >
      <Card className="w-full max-w-md overflow-hidden rounded-2xl !p-0 shadow-xl">
        {/* Minimal Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">New Maternal Record</h3>
          <p className="mt-1 text-sm text-gray-600">Select an action</p>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-3 px-6 py-5">
          {/* Register New Pregnancy */}
          <button
            onClick={onSelectRegister}
            disabled={loading}
            className="group flex items-start gap-4 rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-brand-blue hover:bg-brand-blue/5 disabled:opacity-50"
          >
            <div className="mt-1 rounded-lg bg-brand-blue/10 p-2 text-brand-blue">
              <Baby className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-gray-900 group-hover:text-brand-blue">
                Register New Pregnancy
              </h4>
              <p className="mt-0.5 text-xs text-gray-600">
                Start a new pregnancy record with essential information.
              </p>
            </div>
          </button>

          {/* Record Encounter */}
          <button
            onClick={onSelectEncounter}
            disabled={loading}
            className="group flex items-start gap-4 rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-brand-blue hover:bg-brand-blue/5 disabled:opacity-50"
          >
            <div className="mt-1 rounded-lg bg-brand-blue/10 p-2 text-brand-blue">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-gray-900 group-hover:text-brand-blue">
                Record Maternal Encounter
              </h4>
              <p className="mt-0.5 text-xs text-gray-600">
                Add a prenatal visit, lab result, or postpartum follow-up.
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </Card>
    </div>
  );
}

/**
 * RegisterPregnancyForm — Redesigned, cleaner pregnancy registration and edit modal
 * 
 * EDIT MODE:
 * - Accepts `initial` prop with existing record data
 * - Title changes to "Edit Pregnancy Record"
 * - Button changes to "Save Changes"
 * - Retrieves record by ID for autofill
 * - Updates existing record instead of creating new
 * 
 * REGISTER MODE:
 * - Fresh form for new pregnancy
 * - Title "Register New Pregnancy"
 * - Button "Register Pregnancy"
 */
function RegisterPregnancyForm({
  mode = "register", // 'register' | 'edit'
  initial = null, // For edit mode: existing record
  resident,
  residents,
  saving,
  onClose,
  onSave,
  onSelectResident,
}) {
  const isEditMode = mode === "edit" && initial;

  const [form, setForm] = useState(() => {
    if (isEditMode && initial) {
      return {
        lmp: initial.lmp || "",
        gravida: initial.gravida || "",
        para: initial.para || "",
        dateOfRegistration: initial.dateOfRegistration || "",
        risk: initial.risk || "Low",
        socioEconomicStatus: initial.socioEconomicStatus || "",
        notes: initial.notes || "",
      };
    }
    return {
      lmp: "",
      gravida: "",
      para: "",
      dateOfRegistration: new Date().toISOString().split("T")[0],
      risk: "Low",
      socioEconomicStatus: "",
      notes: "",
    };
  });

  const [errors, setErrors] = useState({});

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const calculateEDD = () => {
    if (!form.lmp) return "";
    const lmp = new Date(form.lmp);
    const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
    return edd.toISOString().split("T")[0];
  };

  const validate = () => {
    const next = {};
    if (!isEditMode && !resident) {
      next.resident = "Please select a resident.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const edd = calculateEDD();
  const modalTitle = isEditMode ? "Edit Pregnancy Record" : "Register New Pregnancy";
  const buttonText = isEditMode ? "Save Changes" : "Register Pregnancy";
  const displayResident = isEditMode ? initial.residentName : resident?.name;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
    >
      <Card className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl !p-0 shadow-xl max-h-[90vh]">
        {/* Fixed Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{modalTitle}</h3>
              <p className="mt-1 text-sm text-gray-600">
                {isEditMode ? "Update pregnancy information" : "Essential information to establish the maternal pregnancy record"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">
            {/* Patient Information */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Patient Information
              </h4>
              {isEditMode ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 border border-gray-200">
                  <p className="text-xs text-gray-600 uppercase">Resident</p>
                  <p className="mt-1 font-medium text-gray-900">{displayResident}</p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Resident <span className="text-brand-danger">*</span>
                  </label>
                  <ResidentSearchSelect residents={residents} value={resident} onChange={onSelectResident} />
                  {errors.resident && <p className="mt-1 text-xs text-brand-danger">{errors.resident}</p>}
                </div>
              )}
            </div>

            {/* Pregnancy Dating */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Pregnancy Dating
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Last Menstrual Period (LMP)
                  </label>
                  <input
                    type="date"
                    value={form.lmp}
                    onChange={(e) => set("lmp")(e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Expected Delivery Date (EDD)
                  </label>
                  <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    {edd || "—"}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Calculated: LMP + 280 days</p>
                </div>
              </div>
            </div>

            {/* Obstetric History */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Obstetric History
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Gravida (G)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.gravida}
                    onChange={(e) => set("gravida")(e.target.value)}
                    placeholder="Total pregnancies"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Para (P)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.para}
                    onChange={(e) => set("para")(e.target.value)}
                    placeholder="Term/preterm births"
                    className={inputCls()}
                  />
                </div>
              </div>
            </div>

            {/* Registration Details */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Registration Details
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Date of Registration
                  </label>
                  <input
                    type="date"
                    value={form.dateOfRegistration}
                    onChange={(e) => set("dateOfRegistration")(e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Risk Classification
                  </label>
                  <select
                    value={form.risk}
                    onChange={(e) => set("risk")(e.target.value)}
                    className={`${inputCls()} cursor-pointer`}
                  >
                    {RISK_LEVELS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Socio-Economic Status
                  </label>
                  <SelectButtonGroup
                    ariaLabel="Socio-Economic Status"
                    options={SES_OPTS}
                    value={form.socioEconomicStatus}
                    onChange={set("socioEconomicStatus")}
                  />
                </div>
              </div>
            </div>

            {/* Initial Assessment */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Clinical Notes
              </h4>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
                placeholder="Initial clinical findings, medical history, risk assessment notes..."
                className={`${inputCls()} resize-none`}
              />
            </div>
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!validate()) return;
              onSave({
                ...form,
                ...(isEditMode ? { id: initial.id } : {}),
              });
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? (isEditMode ? "Saving..." : "Registering...") : buttonText}
          </button>
        </div>
      </Card>
    </div>
  );
}

/**
 * RecordEncounterForm — For existing pregnancies
 */
function RecordEncounterForm({ resident, residents, saving, onClose, onSave, onSelectResident }) {
  const [form, setForm] = useState({
    encounterDate: new Date().toISOString().split("T")[0],
    encounterType: "prenatal",
    weight: "",
    height: "",
    systolicBp: "",
    diastolicBp: "",
    clinicalFindings: "",
    assessment: "",
    carePlan: "",
    nextVisitDate: "",
  });
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const calculateBMI = () => {
    const w = parseFloat(form.weight);
    const h = parseFloat(form.height);
    if (w && h && h > 0) {
      const heightM = h / 100;
      return (w / (heightM * heightM)).toFixed(1);
    }
    return null;
  };

  const validate = () => {
    const next = {};
    if (!resident) next.resident = "Please select a resident.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const bmi = calculateBMI();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record maternal encounter"
    >
      <Card className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl !p-0 shadow-xl max-h-[90vh]">
        {/* Fixed Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Record Maternal Encounter</h3>
              <p className="mt-1 text-sm text-gray-600">
                Document a prenatal visit, laboratory result, or postpartum follow-up.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">
            {/* Patient Information */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Patient Information
              </h4>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Resident <span className="text-brand-danger">*</span>
                </label>
                <ResidentSearchSelect residents={residents} value={resident} onChange={onSelectResident} />
                {errors.resident && <p className="mt-1 text-xs text-brand-danger">{errors.resident}</p>}
              </div>
            </div>

            {/* Encounter Details */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Encounter Information
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Encounter Date</label>
                  <input
                    type="date"
                    value={form.encounterDate}
                    onChange={(e) => set("encounterDate")(e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Encounter Type</label>
                  <select
                    value={form.encounterType}
                    onChange={(e) => set("encounterType")(e.target.value)}
                    className={`${inputCls()} cursor-pointer`}
                  >
                    <option value="prenatal">Prenatal Visit</option>
                    <option value="postpartum">Postpartum Visit</option>
                    <option value="intrapartum">Delivery</option>
                    <option value="screening">Laboratory/Screening</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Vital Signs */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Vital Signs & Measurements
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={form.weight}
                    onChange={(e) => set("weight")(e.target.value)}
                    placeholder="e.g. 65"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Height (cm)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={form.height}
                    onChange={(e) => set("height")(e.target.value)}
                    placeholder="e.g. 165"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">BMI</label>
                  <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    {bmi || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Blood Pressure */}
            <div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Systolic BP (mmHg)</label>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={form.systolicBp}
                    onChange={(e) => set("systolicBp")(e.target.value)}
                    placeholder="e.g. 120"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Diastolic BP (mmHg)</label>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={form.diastolicBp}
                    onChange={(e) => set("diastolicBp")(e.target.value)}
                    placeholder="e.g. 80"
                    className={inputCls()}
                  />
                </div>
              </div>
            </div>

            {/* Clinical Assessment */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Clinical Assessment
              </h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Clinical Findings</label>
                  <textarea
                    rows={2}
                    value={form.clinicalFindings}
                    onChange={(e) => set("clinicalFindings")(e.target.value)}
                    placeholder="Observe only during this visit..."
                    className={`${inputCls()} resize-none`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Assessment</label>
                  <textarea
                    rows={2}
                    value={form.assessment}
                    onChange={(e) => set("assessment")(e.target.value)}
                    placeholder="Clinical assessment and diagnosis..."
                    className={`${inputCls()} resize-none`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Care Plan</label>
                  <textarea
                    rows={2}
                    value={form.carePlan}
                    onChange={(e) => set("carePlan")(e.target.value)}
                    placeholder="Recommended interventions and follow-up..."
                    className={`${inputCls()} resize-none`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Next Visit Date</label>
                  <input
                    type="date"
                    value={form.nextVisitDate}
                    onChange={(e) => set("nextVisitDate")(e.target.value)}
                    className={inputCls()}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!validate()) return;
              onSave(form);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Recording..." : "Record Encounter"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export {
  WorkflowSelector,
  RegisterPregnancyForm,
  RecordEncounterForm,
};
