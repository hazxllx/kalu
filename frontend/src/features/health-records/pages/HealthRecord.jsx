import React from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Syringe, FlaskConical, Download, ClipboardCheck } from "lucide-react";
import { residentTimeline } from "@/services/local/dashboardData";

const vitals = [];

const vaccinations = [];

const labs = [];

// PhilPEN (Philippine Package of Essential Non-communicable Disease
// Interventions) assessment results - read-only for the resident.
const philpenResults = [];

const RESIDENT = {};

const MEDICAL_HISTORY = {};

const RISK_TONES = {
  Low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Moderate: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

export default function HealthRecord() {
  /**
   * Export the resident's personal + health-record data as a downloadable JSON
   * file (frontend only â€” nothing is uploaded or sent to a server).
   */
  const exportHealthRecord = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      resident: {
        name: RESIDENT.name || "Resident",
        barangay: RESIDENT.barangay || "",
        birthday: RESIDENT.birthday || "",
        age: RESIDENT.age ?? null,
        sex: RESIDENT.sex || "",
        bloodType: RESIDENT.bloodType || "",
      },
      vitals,
      medicalHistory: {
        chronicConditions: MEDICAL_HISTORY.chronicConditions || "",
        allergies: MEDICAL_HISTORY.allergies || "",
        currentMedications: MEDICAL_HISTORY.currentMedications || "",
        pregnancyStatus: MEDICAL_HISTORY.pregnancyStatus || "",
      },
      vaccinations,
      laboratoryResults: labs,
      consultationHistory: residentTimeline,
      philpenAssessments: philpenResults,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kalusagap-health-record.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader crumbs={["My Health Record"]} title="My Health Record" subtitle="A complete view of your medical history and vitals." action={
        <button
          onClick={exportHealthRecord}
          className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
        >
          <Download className="w-4 h-4" /> Export Health Record
        </button>
      } />

      <Card className="p-5 mb-6">
        <div className="grid md:grid-cols-2 xl:grid-cols-6 gap-4 text-sm">
          <div><p className="text-brand-gray">Resident Name</p><p className="font-semibold text-brand-ink">{RESIDENT.name || "Resident"}</p></div>
          <div><p className="text-brand-gray">Barangay</p><p className="font-semibold text-brand-ink">{RESIDENT.barangay || "—"}</p></div>
          <div><p className="text-brand-gray">Birthday</p><p className="font-semibold text-brand-ink">{RESIDENT.birthday || "—"}</p></div>
          <div><p className="text-brand-gray">Age</p><p className="font-semibold text-brand-ink">{RESIDENT.age ?? "—"}</p></div>
          <div><p className="text-brand-gray">Sex</p><p className="font-semibold text-brand-ink">{RESIDENT.sex || "—"}</p></div>
          <div><p className="text-brand-gray">Blood Type</p><p className="font-semibold text-brand-ink">{RESIDENT.bloodType || "—"}</p></div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {vitals.length === 0 ? (
          <Card className="p-5 text-sm text-brand-gray xl:col-span-4">No vitals recorded yet.</Card>
        ) : (
          vitals.map((v) => (
            <Card key={v.label} className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><v.icon className="w-5 h-5" strokeWidth={1.8} /></div>
                <div>
                  <p className="text-xs text-brand-gray">{v.label}</p>
                  <p className="font-stat font-bold text-brand-ink">{v.value}</p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Medical History & Allergies</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Chronic Conditions</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.chronicConditions || "—"}</span></div>
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Allergies</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.allergies || "—"}</span></div>
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Current Medications</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.currentMedications || "—"}</span></div>
            <div className="flex justify-between"><span className="text-brand-gray">Pregnancy Status</span><span className="text-brand-ink font-medium">{MEDICAL_HISTORY.pregnancyStatus || "—"}</span></div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><Syringe className="w-4 h-4 text-brand-blue" /> Vaccinations</h3>
          <div className="space-y-3">
            {vaccinations.length === 0 ? (
              <p className="text-sm text-brand-gray">No vaccinations recorded yet.</p>
            ) : (
              vaccinations.map((v) => (
                <div key={v.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                  <div><p className="text-brand-ink font-medium">{v.name}</p><p className="text-brand-gray text-xs">{v.date}</p></div>
                  <span className="text-xs text-brand-green bg-brand-green/10 px-2 py-1 rounded-full">{v.status}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-brand-blue" /> Laboratory Results</h3>
          <div className="space-y-3">
            {labs.length === 0 ? (
              <p className="text-sm text-brand-gray">No laboratory results recorded yet.</p>
            ) : (
              labs.map((l) => (
                <div key={l.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                  <div><p className="text-brand-ink font-medium">{l.name}</p><p className="text-brand-gray text-xs">{l.date}</p></div>
                  <span className="text-brand-ink font-medium">{l.result}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Consultation History</h3>
          {residentTimeline.length === 0 ? (
            <p className="text-sm text-brand-gray">No consultations recorded yet.</p>
          ) : (
            <div className="relative pl-5">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-brand-border" />
              {residentTimeline.slice(0, 4).map((t, i) => (
                <div key={i} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-brand-blue ring-4 ring-white" />
                  <p className="text-xs text-brand-gray">{t.date}</p>
                  <p className="text-sm font-medium text-brand-ink">{t.title}</p>
                  <p className="text-xs text-brand-gray">{t.desc}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* PhilPEN assessment results â€” read-only, own records only */}
        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-brand-blue" /> PhilPEN Assessment Results
          </h3>
          <div className="space-y-4">
            {philpenResults.length === 0 ? (
              <p className="text-sm text-brand-gray">No PhilPEN assessments recorded yet.</p>
            ) : (
              philpenResults.map((a) => (
                <div key={a.date} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-brand-ink">Assessment Date: {a.date}</p>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[a.risk] || RISK_TONES.Low}`}>
                      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {a.risk} Risk
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="text-brand-gray"><span className="font-medium text-brand-ink">Findings:</span> {a.findings}</p>
                    <p className="text-brand-gray"><span className="font-medium text-brand-ink">Recommendations:</span> {a.recommendations}</p>
                    <p className="text-brand-gray"><span className="font-medium text-brand-ink">Follow-up Advice:</span> {a.followUp}</p>
                  </div>
                  <p className="mt-3 text-xs text-brand-gray">Status: {a.status}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}