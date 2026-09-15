import React from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { HeartPulse, Syringe, Droplet, Thermometer, Activity, FlaskConical, Download, ClipboardCheck } from "lucide-react";
import { residentTimeline } from "@/services/mock/mockData";

const vitals = [
  { icon: HeartPulse, label: "Blood Pressure", value: "118/76 mmHg" },
  { icon: Activity, label: "Pulse Rate", value: "72 bpm" },
  { icon: Thermometer, label: "Temperature", value: "36.7 °C" },
  { icon: Droplet, label: "Blood Type", value: "O+" },
];

const vaccinations = [
  { name: "COVID-19 (Primary + Booster)", date: "Jun 2026", status: "Complete" },
  { name: "Tetanus Toxoid (TT2)", date: "Mar 2026", status: "Complete" },
  { name: "Influenza", date: "Jan 2026", status: "Complete" },
];

const labs = [
  { name: "Complete Blood Count", date: "Jul 18, 2026", result: "Normal" },
  { name: "Urinalysis", date: "Jul 18, 2026", result: "Normal" },
  { name: "Blood Glucose (FBS)", date: "May 2026", result: "92 mg/dL" },
];

// PhilPEN (Philippine Package of Essential Non-communicable Disease
// Interventions) assessment results — read-only for the resident.
const philpenResults = [
  {
    date: "September 8, 2026",
    risk: "Moderate",
    status: "Completed",
    findings: "Blood pressure 138/88; BMI within normal range. No tobacco or alcohol use reported.",
    recommendations: "Continue low-sodium diet; monthly BP monitoring at the barangay health station.",
    followUp: "Return for BP re-check on October 8, 2026.",
  },
  {
    date: "June 12, 2026",
    risk: "Low",
    status: "Completed",
    findings: "Blood pressure 122/78; random blood sugar 104 mg/dL. No risk factors identified.",
    recommendations: "Maintain healthy lifestyle; annual re-screening.",
    followUp: "Next routine assessment in June 2027.",
  },
];

const RISK_TONES = {
  Low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Moderate: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

export default function HealthRecord() {
  /**
   * Export the resident's personal + health-record data as a downloadable JSON
   * file (frontend only — nothing is uploaded or sent to a server).
   */
  const exportHealthRecord = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      resident: {
        name: "Maria Santos",
        barangay: "San Isidro",
        birthday: "March 12, 1992",
        age: 34,
        sex: "Female",
        bloodType: "O+",
      },
      vitals,
      medicalHistory: {
        chronicConditions: "None",
        allergies: "Penicillin",
        currentMedications: "Ferrous Sulfate",
        pregnancyStatus: "2nd Trimester",
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
          <div><p className="text-brand-gray">Resident Name</p><p className="font-semibold text-brand-ink">Maria Santos</p></div>
          <div><p className="text-brand-gray">Barangay</p><p className="font-semibold text-brand-ink">San Isidro</p></div>
          <div><p className="text-brand-gray">Birthday</p><p className="font-semibold text-brand-ink">March 12, 1992</p></div>
          <div><p className="text-brand-gray">Age</p><p className="font-semibold text-brand-ink">34</p></div>
          <div><p className="text-brand-gray">Sex</p><p className="font-semibold text-brand-ink">Female</p></div>
          <div><p className="text-brand-gray">Blood Type</p><p className="font-semibold text-brand-ink">O+</p></div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {vitals.map((v) => (
          <Card key={v.label} className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><v.icon className="w-5 h-5" strokeWidth={1.8} /></div>
              <div>
                <p className="text-xs text-brand-gray">{v.label}</p>
                <p className="font-stat font-bold text-brand-ink">{v.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Medical History & Allergies</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Chronic Conditions</span><span className="text-brand-ink font-medium">None</span></div>
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Allergies</span><span className="text-brand-ink font-medium">Penicillin</span></div>
            <div className="flex justify-between border-b border-brand-border pb-3"><span className="text-brand-gray">Current Medications</span><span className="text-brand-ink font-medium">Ferrous Sulfate</span></div>
            <div className="flex justify-between"><span className="text-brand-gray">Pregnancy Status</span><span className="text-brand-ink font-medium">2nd Trimester</span></div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><Syringe className="w-4 h-4 text-brand-blue" /> Vaccinations</h3>
          <div className="space-y-3">
            {vaccinations.map((v) => (
              <div key={v.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                <div><p className="text-brand-ink font-medium">{v.name}</p><p className="text-brand-gray text-xs">{v.date}</p></div>
                <span className="text-xs text-brand-green bg-brand-green/10 px-2 py-1 rounded-full">{v.status}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-brand-blue" /> Laboratory Results</h3>
          <div className="space-y-3">
            {labs.map((l) => (
              <div key={l.name} className="flex items-center justify-between text-sm border-b border-brand-border pb-3 last:border-0 last:pb-0">
                <div><p className="text-brand-ink font-medium">{l.name}</p><p className="text-brand-gray text-xs">{l.date}</p></div>
                <span className="text-brand-ink font-medium">{l.result}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Consultation History</h3>
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
        </Card>

        {/* PhilPEN assessment results — read-only, own records only */}
        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-brand-blue" /> PhilPEN Assessment Results
          </h3>
          <div className="space-y-4">
            {philpenResults.map((a) => (
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
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}