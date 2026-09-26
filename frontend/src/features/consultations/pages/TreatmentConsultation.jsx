import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import DataTable from "@/components/tables/DataTable";
import {
  Search, FileText, Save, X, Plus, CheckCircle2, Users, ChevronLeft, Stethoscope, Calendar,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { consultationsApi, residentsApi } from "@/services/api";

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue ${
    error ? "border-brand-danger bg-red-50/40" : "border-brand-border"
  }`;

const emptyForm = () => ({
  consultationDate: new Date().toISOString().split("T")[0],
  consultationTime: "",
  chiefComplaint: "",
  bloodPressure: "",
  temperature: "",
  pulseRate: "",
  respiratoryRate: "",
  height: "",
  weight: "",
  oxygenSaturation: "",
  findings: "",
  diagnosis: "",
  treatmentGiven: "",
  medicationPrescribed: "",
  adviceGiven: "",
  followUpRequired: "No",
  nextVisitDate: "",
  referralRequired: "No",
  remarks: "",
});

const toResidentOption = (r) => ({
  id: r.id,
  name: r.name || [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
  age: r.age || (r.birthDate ? Math.max(0, new Date().getFullYear() - new Date(r.birthDate).getFullYear()) : "—"),
  sex: r.gender || r.sex || "—",
  barangay: r.barangay || "",
  program: r.program || "General",
  bloodType: r.bloodType || "—",
  contact: r.contact || "—",
});

/** Keep the record list readable: strip time for the table. */
const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Two-letter initials for the resident avatar (local — no external store). */
const initialsOf = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "—";

export default function TreatmentConsultation() {
  const { user } = useAuth();
  const [allResidents, setAllResidents] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Records list view by default. Clicking "+ Add Treatment Consultation"
  // opens the consultation entry form below; saving persists the record to the
  // session store and returns to the list where the new record appears first.
  const [mode, setMode] = useState("list"); // "list" | "form"
  const [editingId, setEditingId] = useState(null);

  const scope = getSupervisorScope(user);
  const allowedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : null;

  const residentOptions = useMemo(() => {
    const pool = allowedBarangays
      ? allResidents.filter((r) => r.barangay && allowedBarangays.includes(r.barangay))
      : allResidents;
    return pool
      .map(toResidentOption)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allResidents, allowedBarangays]);

  const [selectedResident, setSelectedResident] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([residentsApi.list({ limit: 200 }), consultationsApi.list()])
      .then(([residentResult, consultationResult]) => {
        setAllResidents(residentResult?.rows || residentResult || []);
        setConsultations(consultationResult?.rows || []);
      })
      .catch((err) => {
        // A failed load must surface as an explicit error state — never a
        // silent empty "no consultations" list.
        setLoadError(err?.message || "Could not load consultation records.");
        setConsultations([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredResidents = residentOptions.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.barangay.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const startNewConsultation = () => {
    setEditingId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setErrors({});
    setSearchQuery("");
    setMode("form");
  };

  const openForEdit = (record) => {
    setEditingId(record.id);
    setSelectedResident(record.resident || null);
    setFormData({
      consultationDate: record.consultationDate || new Date().toISOString().split("T")[0],
      consultationTime: record.consultationTime || "",
      chiefComplaint: record.chiefComplaint || "",
      bloodPressure: record.bloodPressure || "",
      temperature: record.temperature || "",
      pulseRate: record.pulseRate || "",
      respiratoryRate: record.respiratoryRate || "",
      height: record.height || "",
      weight: record.weight || "",
      oxygenSaturation: record.oxygenSaturation || "",
      findings: record.findings || "",
      diagnosis: record.diagnosis || "",
      treatmentGiven: record.treatmentGiven || "",
      medicationPrescribed: record.medicationPrescribed || "",
      adviceGiven: record.adviceGiven || "",
      followUpRequired: record.followUpRequired || "No",
      nextVisitDate: record.nextVisitDate || "",
      referralRequired: record.referralRequired || "No",
      remarks: record.remarks || "",
    });
    setErrors({});
    setSearchQuery("");
    setMode("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    setMode("list");
    setEditingId(null);
    setSelectedResident(null);
    setFormData(emptyForm());
    setErrors({});
  };

  const validate = () => {
    const next = {};
    if (!selectedResident) next.resident = "Please select a resident.";
    if (!formData.consultationDate) next.consultationDate = "Consultation date is required.";
    if (!formData.chiefComplaint.trim()) next.chiefComplaint = "Chief complaint is required.";
    if (!formData.findings.trim()) next.findings = "Findings are required.";
    if (!formData.diagnosis.trim()) next.diagnosis = "Diagnosis is required.";
    if (!formData.treatmentGiven.trim()) next.treatmentGiven = "Treatment provided is required.";
    if (formData.followUpRequired === "Yes" && !formData.nextVisitDate) {
      next.nextVisitDate = "Next visit date is required when a follow-up is needed.";
    }
    return next;
  };

  const handleSave = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const payload = {
      ...formData,
      residentId: selectedResident.id,
    };
    setBusy(true);
    const request = editingId ? consultationsApi.update(editingId, payload) : consultationsApi.create(payload);
    request.then((result) => {
      const saved = result?.consultation;
      setConsultations((current) => editingId
        ? current.map((item) => item.id === editingId ? saved : item)
        : [saved, ...current]);
      showToast(editingId ? "Consultation updated successfully." : "Consultation saved successfully.");
      cancelForm();
    }).catch((err) => setErrors((prev) => ({ ...prev, submit: err?.message || "Could not save consultation." })))
      .finally(() => setBusy(false));
  };

  const recordRows = useMemo(
    () => consultations.map((c) => ({ ...c })),
    [consultations]
  );

  const columns = [
    { key: "resident", label: "Resident" },
    { key: "date", label: "Consultation Date" },
    { key: "chiefComplaint", label: "Reason / Chief Complaint" },
    { key: "diagnosis", label: "Diagnosis" },
    { key: "followUp", label: "Follow-up" },
    { key: "actions", label: "" },
  ];

  /* ------------------------- Entry form (unchanged style) ------------------------- */
  const renderForm = () => (
    <div className="grid lg:grid-cols-3 gap-5">
      {/* Left Panel - Resident Search */}
      <Card className="p-6 lg:col-span-1 h-fit">
        <h3 className="font-semibold text-brand-ink mb-4">Resident Search</h3>
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5 mb-5">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search resident..."
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {filteredResidents.map((resident) => {
            const active = selectedResident?.id === resident.id;
            return (
              <div
                key={resident.id}
                onClick={() => {
                  setSelectedResident(resident);
                  if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
                }}
                className={`rounded-2xl p-4 cursor-pointer transition-colors ${
                  active ? "bg-brand-light border-2 border-brand-blue" : "bg-brand-light border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold">
                    {resident.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-semibold text-brand-ink">{resident.name}</p>
                    <p className="text-xs text-brand-gray">{resident.age} yrs · {resident.program}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-brand-gray">
                  <p>Barangay: <span className="text-brand-ink">{resident.barangay}</span></p>
                  <p>Sex: <span className="text-brand-ink">{resident.sex}</span></p>
                  <p>Contact: <span className="text-brand-ink">{resident.contact}</span></p>
                </div>
              </div>
            );
          })}
          {filteredResidents.length === 0 && (
            <p className="text-sm text-brand-gray py-6 text-center">No residents found.</p>
          )}
        </div>
        {errors.resident && <p className="mt-3 text-xs text-brand-danger">{errors.resident}</p>}
      </Card>

      {/* Right Panel - Consultation Form */}
      <Card className="p-6 lg:col-span-2">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h3 className="font-semibold text-brand-ink">
            {editingId ? "Edit Treatment Consultation" : "Treatment Consultation Form"}
          </h3>
          {!editingId && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand-blue">
              <Plus className="w-3.5 h-3.5" /> New Consultation
            </span>
          )}
        </div>

        {/* Resident Information */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</h4>
          {selectedResident ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Full Name</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.name}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Age</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.age}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Sex</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.sex}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Barangay</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.barangay}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Program</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.program}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Contact Number</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.contact}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-btn border border-dashed border-brand-border bg-brand-bg/50 px-4 py-6 text-center text-sm text-brand-gray">
              Choose a resident from the search panel on the left.
            </div>
          )}
        </div>

        {/* Consultation Information */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Consultation Information</h4>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs text-brand-gray mb-1">Consultation Date <span className="text-brand-danger">*</span></p>
              <input
                type="date"
                value={formData.consultationDate}
                onChange={(e) => setFormData({ ...formData, consultationDate: e.target.value })}
                className={inputCls(errors.consultationDate)}
              />
              {errors.consultationDate && <p className="mt-1 text-xs text-brand-danger">{errors.consultationDate}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Consultation Time</p>
              <input
                type="time"
                value={formData.consultationTime}
                onChange={(e) => setFormData({ ...formData, consultationTime: e.target.value })}
                className={inputCls()}
              />
            </div>
          </div>
          <div className="mb-4">
            <p className="text-xs text-brand-gray mb-1">Chief Complaint <span className="text-brand-danger">*</span></p>
            <input
              type="text"
              value={formData.chiefComplaint}
              onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
              placeholder="e.g. Fever, headache, prenatal check-up"
              className={inputCls(errors.chiefComplaint)}
            />
            {errors.chiefComplaint && <p className="mt-1 text-xs text-brand-danger">{errors.chiefComplaint}</p>}
          </div>
        </div>

        {/* Vital Signs */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Vital Signs</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-brand-gray mb-1">Blood Pressure (mmHg)</p>
              <input type="text" placeholder="e.g. 120/80" value={formData.bloodPressure} onChange={(e) => setFormData({ ...formData, bloodPressure: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Temperature (°C)</p>
              <input type="text" placeholder="e.g. 36.7" value={formData.temperature} onChange={(e) => setFormData({ ...formData, temperature: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Pulse Rate (bpm)</p>
              <input type="text" placeholder="e.g. 74" value={formData.pulseRate} onChange={(e) => setFormData({ ...formData, pulseRate: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Respiratory Rate (breaths/min)</p>
              <input type="text" placeholder="e.g. 18" value={formData.respiratoryRate} onChange={(e) => setFormData({ ...formData, respiratoryRate: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Height (cm)</p>
              <input type="text" placeholder="e.g. 158" value={formData.height} onChange={(e) => setFormData({ ...formData, height: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Weight (kg)</p>
              <input type="text" placeholder="e.g. 62" value={formData.weight} onChange={(e) => setFormData({ ...formData, weight: e.target.value })} className={inputCls()} />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Oxygen Saturation (%)</p>
              <input type="text" placeholder="e.g. 98" value={formData.oxygenSaturation} onChange={(e) => setFormData({ ...formData, oxygenSaturation: e.target.value })} className={inputCls()} />
            </div>
          </div>
        </div>

        {/* Clinical Assessment */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Clinical Assessment</h4>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-brand-gray mb-1">Findings <span className="text-brand-danger">*</span></p>
              <textarea
                rows={3}
                value={formData.findings}
                onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                className={`${inputCls(errors.findings)} resize-none`}
              />
              {errors.findings && <p className="mt-1 text-xs text-brand-danger">{errors.findings}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Diagnosis / Assessment <span className="text-brand-danger">*</span></p>
              <input
                type="text"
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                placeholder="e.g. Uncomplicated Upper Respiratory Tract Infection"
                className={inputCls(errors.diagnosis)}
              />
              {errors.diagnosis && <p className="mt-1 text-xs text-brand-danger">{errors.diagnosis}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Treatment Provided <span className="text-brand-danger">*</span></p>
              <textarea
                rows={2}
                value={formData.treatmentGiven}
                onChange={(e) => setFormData({ ...formData, treatmentGiven: e.target.value })}
                className={`${inputCls(errors.treatmentGiven)} resize-none`}
              />
              {errors.treatmentGiven && <p className="mt-1 text-xs text-brand-danger">{errors.treatmentGiven}</p>}
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Medications / Prescriptions</p>
              <input
                type="text"
                value={formData.medicationPrescribed}
                onChange={(e) => setFormData({ ...formData, medicationPrescribed: e.target.value })}
                placeholder="e.g. Paracetamol 500mg, Ferrous Sulfate"
                className={inputCls()}
              />
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Recommendations / Instructions</p>
              <textarea
                rows={3}
                value={formData.adviceGiven}
                onChange={(e) => setFormData({ ...formData, adviceGiven: e.target.value })}
                className={`${inputCls()} resize-none`}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Follow-up Required</p>
                <select
                  value={formData.followUpRequired}
                  onChange={(e) => setFormData({ ...formData, followUpRequired: e.target.value })}
                  className={inputCls()}
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
              {formData.followUpRequired === "Yes" && (
                <div>
                  <p className="text-xs text-brand-gray mb-1">Next Visit Date <span className="text-brand-danger">*</span></p>
                  <input
                    type="date"
                    value={formData.nextVisitDate}
                    onChange={(e) => setFormData({ ...formData, nextVisitDate: e.target.value })}
                    className={inputCls(errors.nextVisitDate)}
                  />
                  {errors.nextVisitDate && <p className="mt-1 text-xs text-brand-danger">{errors.nextVisitDate}</p>}
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Referral Required</p>
                <select
                  value={formData.referralRequired}
                  onChange={(e) => setFormData({ ...formData, referralRequired: e.target.value })}
                  className={inputCls()}
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>
            <div>
              <p className="text-xs text-brand-gray mb-1">Notes / Remarks</p>
              <textarea
                rows={2}
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                className={`${inputCls()} resize-none`}
              />
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-brand-border">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
          >
            <Save className="w-4 h-4" /> {editingId ? "Update Consultation" : "Save Consultation"}
          </button>
          <button
            onClick={cancelForm}
            className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      </Card>
    </div>
  );

  /* ----------------------------- Records list ---------------------------- */
  const renderRecords = () => (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-brand-gray">Total Consultations</p>
            <p className="text-2xl font-semibold text-brand-ink mt-0.5">{recordRows.length}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-brand-gray">This Month</p>
            <p className="text-2xl font-semibold text-brand-ink mt-0.5">
              {recordRows.filter((c) => (c.consultationDate || "").startsWith(new Date().toISOString().slice(0, 7))).length}
            </p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-brand-gray">With Follow-up</p>
            <p className="text-2xl font-semibold text-brand-ink mt-0.5">
              {recordRows.filter((c) => c.followUpRequired === "Yes").length}
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-5">
          <h3 className="font-semibold text-brand-ink">Treatment Consultation Records</h3>
          <p className="text-xs text-brand-gray mt-0.5">Consultations recorded for residents in your area.</p>
        </div>

        {loadError ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-brand-danger">{loadError}</p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={recordRows}
              renderCell={(key, row) => {
                if (key === "resident")
                  return (
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                        {initialsOf(row.resident?.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-brand-ink truncate">{row.resident?.name || "—"}</p>
                        <p className="text-xs text-brand-gray">{row.resident?.barangay || ""}</p>
                      </div>
                    </div>
                  );
                if (key === "date") return <span className="text-brand-ink">{formatDate(row.consultationDate)}</span>;
                if (key === "chiefComplaint") return <span className="text-brand-ink">{row.chiefComplaint || "—"}</span>;
                if (key === "diagnosis") return <span className="text-brand-gray">{row.diagnosis || "—"}</span>;
                if (key === "followUp")
                  return row.followUpRequired === "Yes" ? (
                    <span className="inline-flex rounded-full bg-brand-accent/10 text-brand-accent px-2.5 py-1 text-xs font-medium">
                      {row.nextVisitDate ? formatDate(row.nextVisitDate) : "Yes"}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium">No</span>
                  );
                if (key === "actions")
                  return (
                    <button onClick={() => openForEdit(row)} className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline">
                      <FileText className="w-4 h-4" /> View
                    </button>
                  );
                return row[key];
              }}
            />
            {loading ? (
              <p className="py-10 text-center text-sm text-brand-gray">Loading consultations...</p>
            ) : recordRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-brand-gray">No consultations yet. Click "+ Add Treatment Consultation" to record the first one.</p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={["Consultations"]}
        title="Treatment Consultation"
        subtitle="Record consultation findings, treatment, and recommendations for residents."
        action={
          mode === "list" ? (
            <button
              onClick={startNewConsultation}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Treatment Consultation
            </button>
          ) : (
            <button
              onClick={cancelForm}
              className="flex items-center gap-2 border border-brand-border bg-white text-brand-gray px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Records
            </button>
          )
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {mode === "list" ? renderRecords() : renderForm()}
    </>
  );
}
