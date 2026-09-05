import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Search, FileText, Save, X, Plus, CheckCircle2 } from "lucide-react";

const RESIDENTS = [
  { id: 1, name: "Ana Villanueva", age: 32, sex: "Female", barangay: "San Isidro", bloodType: "B+", program: "Maternal Care", contact: "0917 123 4567", initials: "AV" },
  { id: 2, name: "Maria Santos", age: 28, sex: "Female", barangay: "San Isidro", bloodType: "O+", program: "Prenatal Care", contact: "0918 234 5678", initials: "MS" },
  { id: 3, name: "Elena Garcia", age: 25, sex: "Female", barangay: "San Isidro", bloodType: "A+", program: "Maternal Care", contact: "0919 345 6789", initials: "EG" },
];

export default function TreatmentConsultation() {
  const [selectedResident, setSelectedResident] = useState(RESIDENTS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    consultationDate: "July 10, 2026",
    consultationTime: "9:30 AM",
    chiefComplaint: "Routine prenatal check-up",
    bloodPressure: "118/76",
    temperature: "36.7",
    pulseRate: "74",
    respiratoryRate: "18",
    height: "158",
    weight: "62",
    oxygenSaturation: "98",
    findings: "Mother is in good condition. No vaginal bleeding. Normal fetal movement reported. No signs of infection.",
    diagnosis: "Normal Prenatal Progress",
    treatmentGiven: "Routine prenatal assessment completed. Prenatal vitamins continued.",
    medicationPrescribed: "Ferrous Sulfate, Folic Acid",
    adviceGiven: "Continue daily prenatal vitamins. Increase water intake. Maintain balanced nutrition. Return immediately if bleeding or severe abdominal pain occurs.",
    followUpRequired: "Yes",
    nextVisitDate: "July 24, 2026",
    referralRequired: "No",
    remarks: "Pregnancy progressing normally. Continue routine prenatal monitoring.",
  });

  const filteredResidents = RESIDENTS.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.barangay.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const [toast, setToast] = useState(null);
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = () => {
    showToast("Consultation saved successfully.");
  };

  const handleUpdate = () => {
    showToast("Consultation updated successfully.");
  };

  const handleCancel = () => {
    showToast("Changes cancelled.");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Consultations"]}
        title="Treatment Consultation"
        subtitle="Record consultation findings, treatment, and recommendations for residents."
        action={
          <button
            onClick={() => {
              setFormData({
                consultationDate: new Date().toISOString().split('T')[0],
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
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Treatment Consultation
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

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
          <div className="space-y-3">
            {filteredResidents.map((resident) => (
              <div
                key={resident.id}
                onClick={() => setSelectedResident(resident)}
                className={`rounded-2xl p-4 cursor-pointer transition-colors ${
                  selectedResident.id === resident.id ? "bg-brand-light border-2 border-brand-blue" : "bg-brand-light border-2 border-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold">
                    {resident.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-brand-ink">{resident.name}</p>
                    <p className="text-xs text-brand-gray">{resident.age} yrs · {resident.program}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-brand-gray">
                  <p>Barangay: <span className="text-brand-ink">{resident.barangay}</span></p>
                  <p>Blood Type: <span className="text-brand-ink">{resident.bloodType}</span></p>
                  <p>Contact: <span className="text-brand-ink">{resident.contact}</span></p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right Panel - Consultation Form */}
        <Card className={`p-6 ${"lg:col-span-2"}`}>
          <h3 className="font-semibold text-brand-ink mb-6">Treatment Consultation Form</h3>

          {/* Resident Information */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</h4>
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
                <p className="text-xs text-brand-gray mb-1">Blood Type</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.bloodType}</p>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Contact Number</p>
                <p className="text-sm font-medium text-brand-ink">{selectedResident.contact}</p>
              </div>
            </div>
          </div>

          {/* Consultation Information */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Consultation Information</h4>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Consultation Date</p>
                <input
                  type="date"
                  value={formData.consultationDate}
                  onChange={(e) => setFormData({ ...formData, consultationDate: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Consultation Time</p>
                <input
                  type="time"
                  value={formData.consultationTime}
                  onChange={(e) => setFormData({ ...formData, consultationTime: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
            </div>
            <div className="mb-4">
              <p className="text-xs text-brand-gray mb-1">Chief Complaint</p>
              <input
                type="text"
                value={formData.chiefComplaint}
                onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
              />
            </div>
          </div>

          {/* Vital Signs */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Vital Signs</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Blood Pressure (mmHg)</p>
                <input
                  type="text"
                  value={formData.bloodPressure}
                  onChange={(e) => setFormData({ ...formData, bloodPressure: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Temperature (°C)</p>
                <input
                  type="text"
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Pulse Rate (bpm)</p>
                <input
                  type="text"
                  value={formData.pulseRate}
                  onChange={(e) => setFormData({ ...formData, pulseRate: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Respiratory Rate (breaths/min)</p>
                <input
                  type="text"
                  value={formData.respiratoryRate}
                  onChange={(e) => setFormData({ ...formData, respiratoryRate: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Height (cm)</p>
                <input
                  type="text"
                  value={formData.height}
                  onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Weight (kg)</p>
                <input
                  type="text"
                  value={formData.weight}
                  onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Oxygen Saturation (%)</p>
                <input
                  type="text"
                  value={formData.oxygenSaturation}
                  onChange={(e) => setFormData({ ...formData, oxygenSaturation: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
            </div>
          </div>

          {/* Clinical Assessment */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-brand-gray uppercase tracking-wide mb-3">Clinical Assessment</h4>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-brand-gray mb-1">Findings</p>
                <textarea
                  rows={3}
                  value={formData.findings}
                  onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Diagnosis</p>
                <input
                  type="text"
                  value={formData.diagnosis}
                  onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Treatment Given</p>
                <textarea
                  rows={2}
                  value={formData.treatmentGiven}
                  onChange={(e) => setFormData({ ...formData, treatmentGiven: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Medication Prescribed</p>
                <input
                  type="text"
                  value={formData.medicationPrescribed}
                  onChange={(e) => setFormData({ ...formData, medicationPrescribed: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Advice Given</p>
                <textarea
                  rows={3}
                  value={formData.adviceGiven}
                  onChange={(e) => setFormData({ ...formData, adviceGiven: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-brand-gray mb-1">Follow-up Required</p>
                  <select
                    value={formData.followUpRequired}
                    onChange={(e) => setFormData({ ...formData, followUpRequired: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
                {formData.followUpRequired === "Yes" && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Next Visit Date</p>
                    <input
                      type="date"
                      value={formData.nextVisitDate}
                      onChange={(e) => setFormData({ ...formData, nextVisitDate: e.target.value })}
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-brand-gray mb-1">Referral Required</p>
                  <select
                    value={formData.referralRequired}
                    onChange={(e) => setFormData({ ...formData, referralRequired: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </div>
              </div>
              <div>
                <p className="text-xs text-brand-gray mb-1">Remarks</p>
                <textarea
                  rows={2}
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-brand-border">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
            >
              <Save className="w-4 h-4" /> Save Consultation
            </button>
            <button
              onClick={handleUpdate}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium border border-brand-blue text-brand-blue hover:bg-brand-light transition-colors"
            >
              <FileText className="w-4 h-4" /> Update Consultation
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
