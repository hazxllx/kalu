import React, { useState, useMemo } from "react";
import { Search, Filter, Send } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";

const REFERRALS = [
  { resident: "Maria Santos", barangay: "San Isidro", facility: "RHU Pili", date: "2026-07-05", status: "Pending", personnel: "Nurse R. Dela Cruz" },
  { resident: "Juan Dela Cruz", barangay: "San Isidro", facility: "RHU Pili", date: "2026-07-04", status: "Accepted", personnel: "Nurse R. Dela Cruz" },
  { resident: "Ana Garcia", barangay: "San Antonio", facility: "RHU Pili", date: "2026-07-03", status: "Completed", personnel: "Midwife M. Lopez" },
  { resident: "Roberto Lim", barangay: "San Isidro", facility: "RHU Pili", date: "2026-07-02", status: "Pending", personnel: "Nurse R. Dela Cruz" },
  { resident: "Carmen Reyes", barangay: "San Antonio", facility: "RHU Pili", date: "2026-06-30", status: "Accepted", personnel: "Midwife M. Lopez" },
];

const BARANGAYS = ["All", "San Isidro", "San Antonio", "Old San Roque"];
const STATUSES = ["All", "Pending", "Accepted", "Completed"];

export default function MHOReferrals() {
  const [barangay, setBarangay] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return REFERRALS.filter((r) => {
      if (barangay !== "All" && r.barangay !== barangay) return false;
      if (status !== "All" && r.status !== status) return false;
      if (search && !r.resident.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [barangay, status, search]);

  return (
    <>
      <PageHeader
        crumbs={["Home", "Referrals"]}
        title="Referral Monitoring"
        subtitle="Monitor referrals across all barangays in the municipality"
      />

      <Card className="p-5 mb-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3 py-2.5">
            <Search className="w-4 h-4 text-brand-gray" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident..." className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/50" />
          </div>
          <div className="flex items-center gap-2 bg-white border border-brand-border rounded-input px-3 py-2.5">
            <Filter className="w-4 h-4 text-brand-gray" />
            <select value={barangay} onChange={(e) => setBarangay(e.target.value)} className="bg-transparent text-sm outline-none w-full cursor-pointer">
              {BARANGAYS.map((b) => <option key={b} value={b}>{b === "All" ? "All Barangays" : b}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-white border border-brand-border rounded-input px-3 py-2.5">
            <Filter className="w-4 h-4 text-brand-gray" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-transparent text-sm outline-none w-full cursor-pointer">
              {STATUSES.map((s) => <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-center bg-brand-bg rounded-input px-3 py-2.5 text-sm text-brand-gray">
            <Send className="w-4 h-4 mr-2 text-brand-blue" /> {filtered.length} referral{filtered.length !== 1 ? "s" : ""} found
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg border-b border-brand-border text-left">
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Resident Name</th>
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Referring Barangay</th>
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Receiving RHU Facility</th>
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Referral Date</th>
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Status</th>
                <th className="px-5 py-3 text-xs font-medium text-brand-gray uppercase">Assigned Personnel</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50 transition-colors">
                  <td className="px-5 py-3 font-medium text-brand-ink">{r.resident}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.barangay}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.facility}</td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{r.date}</td>
                  <td className="px-5 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{r.personnel}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-brand-gray text-sm">No referrals match the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}