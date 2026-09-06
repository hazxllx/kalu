import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { residents } from "@/services/mock/mockData";
import { phnResidents } from "@/services/mock/mockPhnData";
import { CHECKUP_STATUS, useWorkflowStore, sendToPhnQueue } from "@/services/mock/mockWorkflowStore";
import { BARANGAYS } from "@/lib/barangays";
import { CONSULTATION_LOCATIONS, barangayHealthCenter } from "@/lib/consultationLocations";
import { useAuth } from "@/context/AuthContext";
import { Search, CheckCircle2, Send, Plus, X, Users } from "lucide-react";

const STATUS_TONES = {
  [CHECKUP_STATUS.WAITING]: "bg-brand-accent/10 text-brand-accent",
  [CHECKUP_STATUS.IN_CHECKUP]: "bg-brand-blue/10 text-brand-blue",
  [CHECKUP_STATUS.COMPLETED]: "bg-brand-green/10 text-brand-green",
};

const blankForm = () => ({
  resident: null,
  walkIn: false,
  name: "",
  age: "",
  sex: "Female",
  barangay: "RHU",
  consultationLocation: "RHU",
  reason: "",
  temperature: "",
  bloodPressure: "",
  pulseRate: "",
  respiratoryRate: "",
  oxygenSaturation: "",
  weight: "",
  notes: "",
  visitDate: new Date().toISOString().slice(0, 10),
});

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

export default function RhuTriage() {
  const { user } = useAuth();
  const store = useWorkflowStore();
  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);

  // Resident registry the RHU can pull from (deduplicated by name).
  const registry = useMemo(() => {
    const seen = new Set();
    const out = [];
    [...phnResidents, ...residents].forEach((r) => {
      const name = String(r.name || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({
        id: r.id || name,
        name,
        age: r.age,
        gender: r.gender || r.sex || "Female",
        barangay: r.barangay || null,
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const sentPatients = store.patients;

  const visibleHistory = useMemo(
    () =>
      sentPatients.filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.patient.toLowerCase().includes(q) ||
          (p.reason || "").toLowerCase().includes(q) ||
          (p.barangay || "RHU").toLowerCase().includes(q)
        );
      }),
    [sentPatients, searchQuery]
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const handleResidentSelect = (resident) => {
    if (!resident) {
      setField("resident", null);
      return;
    }
    setForm((prev) => ({
      ...prev,
      resident,
      walkIn: false,
      name: resident.name,
      age: resident.age !== undefined && resident.age !== null ? String(resident.age) : "",
      sex: String(resident.gender || "").toLowerCase() === "male" ? "Male" : "Female",
      barangay: resident.barangay || "RHU",
      // When a barangay resident is selected, default the consultation to that
      // barangay's health center. RHU Personnel can still override to RHU when
      // the actual visit happens at the RHU.
      consultationLocation:
        prev.consultationLocation === barangayHealthCenter(prev.barangay) || prev.barangay === "RHU"
          ? barangayHealthCenter(resident.barangay)
          : prev.consultationLocation || barangayHealthCenter(resident.barangay),
    }));
    if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
  };

  const enableWalkIn = () => {
    setForm((prev) => ({ ...blankForm(), walkIn: true }));
    setErrors({});
  };

  const validate = () => {
    const next = {};
    if (!form.walkIn && !form.resident) next.resident = "Select a resident or add a walk-in patient.";
    if (!form.name.trim()) next.name = "Patient name is required.";
    if (!form.barangay) next.barangay = "Barangay is required.";
    if (!form.reason.trim()) next.reason = "Chief complaint / reason for visit is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCompleteTriage = () => {
    if (!validate()) return;

    const payload = {
      patient: form.name.trim(),
      age: form.age !== "" && !Number.isNaN(Number(form.age)) ? Number(form.age) : null,
      sex: form.sex,
      barangay: form.barangay === "RHU" ? null : form.barangay,
      reason: form.reason.trim(),
      chiefComplaint: form.reason.trim(),
      temperature: form.temperature.trim() || null,
      bloodPressure: form.bloodPressure.trim() || null,
      pulseRate: form.pulseRate.trim() || null,
      respiratoryRate: form.respiratoryRate.trim() || null,
      oxygenSaturation: form.oxygenSaturation.trim() || null,
      weight: form.weight.trim() || null,
      notes: form.notes.trim(),
      consultationLocation: form.consultationLocation || "RHU",
      personnel: form.personnel || user?.name || "RHU Personnel",
      visitDate: form.visitDate
        ? new Date(`${form.visitDate}T00:00:00`).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "",
    };

    sendToPhnQueue(payload);
    setForm(blankForm());
    setErrors({});
    showToast("Triage completed — patient sent to the PHN check-up queue.");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Triage"]}
        title="RHU Triage"
        subtitle="Record patient triage information and route patients to the PHN for check-up."
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">
        {/* Patient list sent to the PHN */}
        <Card className="p-4 sm:p-6 lg:col-span-3 h-fit">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Sent to PHN</h3>
              <p className="text-xs text-brand-gray mt-0.5">Patients triaged at the RHU and their current status.</p>
            </div>
            <Users className="w-4 h-4 text-brand-gray shrink-0" />
          </div>
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 mb-4">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by patient, reason, or scope..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-bg border-b border-brand-border text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Patient</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Barangay</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Reason for Visit</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((p) => (
                  <tr key={p.id} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-ink">{p.patient}</p>
                      <p className="text-xs text-brand-gray">{p.age ?? "—"} yrs · {p.sex}</p>
                    </td>
                    <td className="px-4 py-3 text-brand-ink">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${p.barangay ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
                        {p.barangay || "RHU"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-brand-ink">{p.reason || p.triage?.chiefComplaint}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[p.status] || "bg-slate-100 text-slate-600"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {visibleHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-brand-gray">
                      No patients have been sent to the PHN yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* New triage form */}
        <Card className="p-4 sm:p-6 lg:col-span-2 h-fit">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-brand-ink text-sm sm:text-base">New Triage</h3>
              <p className="text-xs text-brand-gray mt-0.5">Complete triage to send the patient to the PHN.</p>
            </div>
            {!form.walkIn ? (
              <button
                onClick={enableWalkIn}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-blue hover:underline shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Walk-in patient
              </button>
            ) : (
              <button
                onClick={() => setForm(blankForm())}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-gray hover:underline shrink-0"
              >
                <X className="w-3.5 h-3.5" /> Use registered resident
              </button>
            )}
          </div>

          <div className="space-y-4">
            {!form.walkIn ? (
              <div>
                <label className="text-sm font-medium text-brand-ink block mb-1.5">
                  Patient <span className="text-brand-danger">*</span>
                </label>
                <ResidentSearchSelect
                  residents={registry}
                  value={form.resident}
                  onChange={handleResidentSelect}
                  placeholder="Search registered resident..."
                />
                {errors.resident && <p className="text-xs text-brand-danger mt-1">{errors.resident}</p>}
              </div>
            ) : (
              <p className="rounded-btn bg-brand-blue/5 border border-brand-blue/10 px-3 py-2.5 text-xs text-brand-gray">
                Entering a walk-in patient. They will be added to the shared registry after triage.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium text-brand-ink block mb-1.5">
                  Full Name <span className="text-brand-danger">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Patient name..."
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  className={inputCls(errors.name)}
                />
                {errors.name && <p className="text-xs text-brand-danger mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink block mb-1.5">Age</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Age..."
                  value={form.age}
                  onChange={(e) => setField("age", e.target.value)}
                  className={inputCls()}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink block mb-1.5">Sex</label>
                <select value={form.sex} onChange={(e) => setField("sex", e.target.value)} className={inputCls()}>
                  <option>Female</option>
                  <option>Male</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium text-brand-ink block mb-1.5">
                  Barangay <span className="text-brand-danger">*</span>
                </label>
                <select value={form.barangay} onChange={(e) => setField("barangay", e.target.value)} className={inputCls(errors.barangay)}>
                  <option value="RHU">RHU (no barangay)</option>
                  {BARANGAYS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                {errors.barangay && <p className="text-xs text-brand-danger mt-1">{errors.barangay}</p>}
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium text-brand-ink block mb-1.5">Consultation Location</label>
                <select
                  value={form.consultationLocation}
                  onChange={(e) => setField("consultationLocation", e.target.value)}
                  className={inputCls()}
                >
                  {CONSULTATION_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink block mb-1.5">
                Chief Complaint / Reason for Visit <span className="text-brand-danger">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. BP re-check, cough for 2 weeks..."
                value={form.reason}
                onChange={(e) => setField("reason", e.target.value)}
                className={inputCls(errors.reason)}
              />
              {errors.reason && <p className="text-xs text-brand-danger mt-1">{errors.reason}</p>}
            </div>

            <div>
              <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-2">Vital Signs</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Temperature (°C)</label>
                  <input
                    type="text"
                    placeholder="e.g. 36.8"
                    value={form.temperature}
                    onChange={(e) => setField("temperature", e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Blood Pressure (mmHg)</label>
                  <input
                    type="text"
                    placeholder="e.g. 120/80"
                    value={form.bloodPressure}
                    onChange={(e) => setField("bloodPressure", e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Pulse Rate (bpm)</label>
                  <input
                    type="text"
                    placeholder="e.g. 78"
                    value={form.pulseRate}
                    onChange={(e) => setField("pulseRate", e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Respiratory Rate (/min)</label>
                  <input
                    type="text"
                    placeholder="e.g. 18"
                    value={form.respiratoryRate}
                    onChange={(e) => setField("respiratoryRate", e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">O2 Saturation (%) <span className="text-brand-gray font-normal">(if available)</span></label>
                  <input
                    type="text"
                    placeholder="e.g. 97"
                    value={form.oxygenSaturation}
                    onChange={(e) => setField("oxygenSaturation", e.target.value)}
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Weight (kg) <span className="text-brand-gray font-normal">(if available)</span></label>
                  <input
                    type="text"
                    placeholder="e.g. 62"
                    value={form.weight}
                    onChange={(e) => setField("weight", e.target.value)}
                    className={inputCls()}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink block mb-1.5">Triage Notes</label>
              <textarea
                rows={2}
                placeholder="Additional triage notes..."
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                className={`${inputCls()} resize-none`}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink block mb-1.5">Triage Personnel</label>
              <input
                type="text"
                value={form.personnel || user?.name || "RHU Personnel"}
                onChange={(e) => setField("personnel", e.target.value)}
                className={inputCls()}
              />
            </div>

            <button
              onClick={handleCompleteTriage}
              className="flex w-full items-center justify-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Send className="w-4 h-4" /> Complete Triage &amp; Send to PHN
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
