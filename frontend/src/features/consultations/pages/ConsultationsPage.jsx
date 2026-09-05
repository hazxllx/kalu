import React from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Search, ClipboardList, Stethoscope, Pill, CalendarClock } from "lucide-react";

const history = [
  { date: "July 2, 2026", worker: "Maria Cruz, BHW", reason: "Fever", diagnosis: "Viral Infection", status: "Completed" },
  { date: "June 18, 2026", worker: "Maria Cruz, BHW", reason: "Prenatal Check-up", diagnosis: "Routine Monitoring", status: "Completed" },
  { date: "June 5, 2026", worker: "Maria Cruz, BHW", reason: "Blood Pressure", diagnosis: "Hypertension Monitoring", status: "Completed" },
];

export default function ConsultationsPage({ showResidentSearch = true }) {
  return (
    <>
      <PageHeader crumbs={["Home", "Consultations"]} title="Consultation History" subtitle="View completed consultations recorded for residents in your barangay." />

      <div className="grid lg:grid-cols-3 gap-5">
        {showResidentSearch && (
          <Card className="p-6 lg:col-span-1 h-fit">
            <h3 className="font-semibold text-brand-ink mb-4">Resident Search</h3>
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
                <p>Barangay: <span className="text-brand-ink">San Isidro</span></p>
                <p>Blood Type: <span className="text-brand-ink">B+</span></p>
                <p>Last Visit: <span className="text-brand-ink">July 2, 2026</span></p>
              </div>
            </div>
          </Card>
        )}

        <Card className={`p-6 ${showResidentSearch ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="flex items-center gap-2 text-brand-blue mb-4">
            <ClipboardList className="w-4 h-4" />
            <h3 className="font-semibold text-brand-ink">Completed Consultations</h3>
          </div>
          <div className="space-y-3">
            {history.map((item) => (
              <div key={item.date} className="border border-brand-border rounded-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-brand-ink">{item.date}</p>
                  <span className="text-xs text-brand-green bg-brand-green/10 px-2.5 py-1 rounded-full">{item.status}</span>
                </div>
                <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm text-brand-gray">
                  <p className="flex items-center gap-2"><Stethoscope className="w-4 h-4 text-brand-blue" /> Health Worker: {item.worker}</p>
                  <p className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-brand-blue" /> Reason: {item.reason}</p>
                  <p className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-brand-blue" /> Diagnosis: {item.diagnosis}</p>
                  <p className="flex items-center gap-2"><Pill className="w-4 h-4 text-brand-blue" /> Follow-up: Routine monitoring</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}