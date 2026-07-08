import React from "react";
import { Card } from "@/components/shared/Card";
import { FileHeart, ArrowRight, User, MapPin, Calendar, HeartPulse } from "lucide-react";

const resident = {
  name: "Maria Santos",
  barangay: "San Jose",
  birthday: "March 12, 1992",
  age: "34",
  sex: "Female",
  bloodType: "O+",
  lastVisit: "July 2, 2026",
  assignedHealthWorker: "Maria Cruz, BHW",
};

export default function HealthProfileCard() {
  return (
    <Card className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-brand-gray">Resident Summary</p>
          <h2 className="mt-2 text-xl font-heading font-semibold text-brand-ink">{resident.name}</h2>
          <p className="text-sm text-brand-gray">Barangay {resident.barangay}</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
          Export Health Record
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Birthday</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.birthday}</p>
        </div>
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Age</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.age}</p>
        </div>
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Sex</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.sex}</p>
        </div>
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Blood Type</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.bloodType}</p>
        </div>
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Last Visit</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.lastVisit}</p>
        </div>
        <div className="rounded-card border border-brand-border bg-brand-bg p-4">
          <p className="text-xs text-brand-gray">Assigned Health Worker</p>
          <p className="mt-2 font-semibold text-brand-ink">{resident.assignedHealthWorker}</p>
        </div>
      </div>
    </Card>
  );
}
