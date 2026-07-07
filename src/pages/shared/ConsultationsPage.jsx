import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { Search, Save } from "lucide-react";

const vitalFields = ["Height (cm)", "Weight (kg)", "Blood Pressure", "Temperature (°C)", "Pulse Rate", "Respiratory Rate", "Oxygen Saturation (%)"];
const vitalDefaults = ["158", "62", "118/76", "36.7", "72", "18", "98"];

function Field({ label, defaultValue, textarea }) {
  return (
    <div>
      <label className="text-sm font-medium text-brand-ink">{label}</label>
      {textarea ? (
        <textarea defaultValue={defaultValue} rows={2} className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue resize-none" />
      ) : (
        <input defaultValue={defaultValue} className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue" />
      )}
    </div>
  );
}

export default function ConsultationsPage() {
  return (
    <>
      <PageHeader crumbs={["Home", "Consultations"]} title="New Consultation" subtitle="Record a patient consultation with vitals and assessment."
        action={<button className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><Save className="w-4 h-4" /> Save Consultation</button>} />

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-6 lg:col-span-1 h-fit">
          <h3 className="font-semibold text-brand-ink mb-4">Search Resident</h3>
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5 mb-5">
            <Search className="w-4 h-4 text-brand-gray" />
            <input placeholder="Search resident..." className="bg-transparent text-sm outline-none w-full" />
          </div>
          <div className="rounded-2xl bg-brand-light p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-brand-blue text-white flex items-center justify-center font-semibold">AV</div>
              <div>
                <p className="font-semibold text-brand-ink">Ana Villanueva</p>
                <p className="text-xs text-brand-gray">32 yrs · Maternal Care</p>
              </div>
            </div>
            <div className="mt-4 space-y-1.5 text-sm text-brand-gray">
              <p>Allergies: <span className="text-brand-ink">None</span></p>
              <p>Chronic: <span className="text-brand-ink">None</span></p>
              <p>Blood Type: <span className="text-brand-ink">B+</span></p>
            </div>
          </div>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink mb-4">Vital Signs</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {vitalFields.map((v, i) => <Field key={v} label={v} defaultValue={vitalDefaults[i]} />)}
          </div>
          <div className="mt-6 space-y-4">
            <Field label="Chief Complaint" defaultValue="Mild headache and fatigue" textarea />
            <Field label="Assessment / Diagnosis" defaultValue="Anemia in pregnancy (mild)" textarea />
            <Field label="Treatment & Prescription" defaultValue="Ferrous sulfate 325mg OD, increase iron-rich diet" textarea />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Referral" defaultValue="None" />
              <Field label="Follow-up Schedule" defaultValue="2026-08-15" />
            </div>
            <Field label="Notes" defaultValue="Advise adequate rest and hydration." textarea />
          </div>
        </Card>
      </div>
    </>
  );
}