import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Syringe, FlaskConical, Download, ClipboardCheck, Stethoscope, Loader2 } from "lucide-react";
import { residentsApi } from "@/services/api";
import { downloadHealthRecordPdf } from "@/features/health-records/lib/healthRecordPdf";

// These sections are sourced from separate modules (immunization, laboratory,
// PhilPEN) that are not part of the consultation record. They intentionally
// render an empty state here until those data sources are wired to the resident
// view; the consultation history + vitals below come from the live API.
const vaccinations = [];
const labs = [];
const philpenResults = [];
const MEDICAL_HISTORY = {};

const RISK_TONES = {
  Low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Moderate: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Build the vital-sign cards from a consultation's stored vitals. */
const vitalCards = (vitals = {}) => {
  const cards = [
    { label: "Blood Pressure", value: vitals.bloodPressure, unit: "mmHg" },
    { label: "Temperature", value: vitals.temperature, unit: "°C" },
    { label: "Pulse Rate", value: vitals.pulseRate, unit: "bpm" },
    { label: "Respiratory Rate", value: vitals.respiratoryRate, unit: "breaths/min" },
    { label: "Oxygen Saturation", value: vitals.oxygenSaturation, unit: "%" },
    { label: "Height", value: vitals.height, unit: "cm" },
    { label: "Weight", value: vitals.weight, unit: "kg" },
    { label: "BMI", value: vitals.bmi, unit: vitals.bmiCategory || "" },
  ];
  return cards.filter((c) => c.value !== null && c.value !== undefined && c.value !== "");
};

export default function HealthRecord() {
  const [resident, setResident] = useState(null);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    residentsApi
      .myHealthRecords()
      .then((data) => {
        if (!active) return;
        setResident(data?.resident || null);
        setConsultations(Array.isArray(data?.consultations) ? data.consultations : []);
      })
      .catch((err) => {
        if (!active) return;
        // Surface the failure; never render a silent empty record.
        setError(err?.message || "Could not load your health record. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const latestVitals = useMemo(
    () => (consultations.length ? vitalCards(consultations[0].vitals) : []),
    [consultations],
  );

  /**
   * Export the resident's own health record as a formatted PDF document. The
   * PDF is generated in the browser (jsPDF) from the SAME data object this page
   * already loaded — nothing is re-fetched, uploaded or sent to a server.
   */
  const exportHealthRecord = useCallback(async () => {
    // Prevent overlapping / simultaneous exports.
    if (exportingRef.current) return;
    if (!resident && consultations.length === 0) {
      setExportError("Unable to export health record. Please try again.");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    try {
      await downloadHealthRecordPdf({
        resident: resident || {},
        consultations,
        // These sections have no resident-facing data source yet; the PDF
        // renders them as empty / "Not available" rather than inventing values.
        vaccinations,
        labs,
        medicalHistory: MEDICAL_HISTORY,
      });
    } catch {
      setExportError("Unable to export health record. Please try again.");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [resident, consultations]);

  return (
    <>
      <PageHeader
        crumbs={["My Health Record"]}
        title="My Health Record"
        subtitle="A complete view of your medical history and vitals."
        action={
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={exportHealthRecord}
              disabled={loading || !!error || exporting}
              aria-busy={exporting}
              className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Export Health Record
                </>
              )}
            </button>
            {exportError && <span className="text-xs text-brand-danger">{exportError}</span>}
          </div>
        }
      />

      {error && (
        <Card className="mb-6 border-brand-danger/30 bg-brand-danger/5 p-4">
          <p className="text-sm font-semibold text-brand-danger">Couldn't load your health record</p>
          <p className="mt-0.5 text-xs text-brand-gray">{error}</p>
        </Card>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-brand-gray">Loading your health record…</Card>
      ) : (
        <>
          <Card className="p-5 mb-6">
            <div className="grid md:grid-cols-2 xl:grid-cols-6 gap-4 text-sm">
              <div><p className="text-brand-gray">Resident Name</p><p className="font-semibold text-brand-ink">{dash(resident?.name)}</p></div>
              <div><p className="text-brand-gray">Barangay</p><p className="font-semibold text-brand-ink">{dash(resident?.barangay)}</p></div>
              <div><p className="text-brand-gray">Birthday</p><p className="font-semibold text-brand-ink">{dash(resident?.birthDate)}</p></div>
              <div><p className="text-brand-gray">Age</p><p className="font-semibold text-brand-ink">{dash(resident?.age)}</p></div>
              <div><p className="text-brand-gray">Sex</p><p className="font-semibold text-brand-ink">{dash(resident?.sex)}</p></div>
              <div><p className="text-brand-gray">Verification</p><p className="font-semibold text-brand-ink capitalize">{dash(resident?.verificationStatus)}</p></div>
            </div>
          </Card>

          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-gray uppercase tracking-wide">
              Latest Vitals{consultations.length ? ` — ${formatDate(consultations[0].date)}` : ""}
            </h3>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {latestVitals.length === 0 ? (
              <Card className="p-5 text-sm text-brand-gray xl:col-span-4">No vitals recorded yet.</Card>
            ) : (
              latestVitals.map((v) => (
                <Card key={v.label} className="p-5">
                  <p className="text-xs text-brand-gray">{v.label}</p>
                  <p className="font-stat font-bold text-brand-ink text-lg">
                    {v.value} {v.unit && <span className="text-xs font-normal text-brand-gray">{v.unit}</span>}
                  </p>
                </Card>
              ))
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Card className="p-6 lg:col-span-2">
              <h3 className="font-semibold text-brand-ink mb-4 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-brand-blue" /> Consultation History
              </h3>
              {consultations.length === 0 ? (
                <p className="text-sm text-brand-gray">No consultations recorded yet.</p>
              ) : (
                <div className="space-y-4">
                  {consultations.map((c) => (
                    <div key={c.id} className="rounded-2xl border border-brand-border bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-brand-ink">
                          {formatDate(c.date)}{c.time ? ` · ${c.time}` : ""}
                        </p>
                        {c.seenBy && <span className="text-xs text-brand-gray">Seen by {c.seenBy}</span>}
                      </div>
                      <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <p className="text-brand-gray"><span className="font-medium text-brand-ink">Chief Complaint:</span> {dash(c.chiefComplaint)}</p>
                        <p className="text-brand-gray"><span className="font-medium text-brand-ink">Diagnosis:</span> {dash(c.diagnosis)}</p>
                        <p className="text-brand-gray"><span className="font-medium text-brand-ink">Findings:</span> {dash(c.findings)}</p>
                        <p className="text-brand-gray"><span className="font-medium text-brand-ink">Treatment:</span> {dash(c.treatmentGiven)}</p>
                        {c.medications && <p className="text-brand-gray"><span className="font-medium text-brand-ink">Medications:</span> {c.medications}</p>}
                        {c.recommendations && <p className="text-brand-gray"><span className="font-medium text-brand-ink">Recommendations:</span> {c.recommendations}</p>}
                        <p className="text-brand-gray"><span className="font-medium text-brand-ink">Follow-up:</span> {c.followUpRequired === "Yes" ? `Yes${c.nextVisitDate ? ` (${formatDate(c.nextVisitDate)})` : ""}` : "No"}</p>
                      </div>
                      {vitalCards(c.vitals).length > 0 && (
                        <p className="mt-3 text-xs text-brand-gray">
                          {vitalCards(c.vitals).map((v) => `${v.label}: ${v.value}${v.unit ? ` ${v.unit}` : ""}`).join(" · ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

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

            {/* PhilPEN assessment results — read-only, own records only */}
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
      )}
    </>
  );
}
