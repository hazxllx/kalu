import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/Badge";
import { Card } from "@/components/shared/Card";
import { Search, Download, SlidersHorizontal, Eye } from "lucide-react";
import { residents } from "@/lib/mockData";

export default function ResidentsPage() {
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState("All");
  const rows = residents.filter((r) =>
    (risk === "All" || r.risk === risk) &&
    (r.name.toLowerCase().includes(q.toLowerCase()) || r.barangay.toLowerCase().includes(q.toLowerCase()))
  );

  const columns = [
    { key: "name", label: "Resident" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Gender" },
    { key: "program", label: "Program" },
    { key: "risk", label: "Risk" },
    { key: "barangay", label: "Barangay" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];

  return (
    <>
      <PageHeader crumbs={["Home", "Residents"]} title="Resident Directory" subtitle="Search, filter, and manage residents in your area."
        action={<button className="flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-ink hover:border-brand-blue transition-colors"><Download className="w-4 h-4" /> Export</button>} />

      <Card className="p-4 mb-5 flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1">
          <Search className="w-4 h-4 text-brand-gray" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or barangay..." className="bg-transparent text-sm outline-none w-full" />
        </div>
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
          <SlidersHorizontal className="w-4 h-4 text-brand-gray" />
          <select value={risk} onChange={(e) => setRisk(e.target.value)} className="bg-transparent text-sm outline-none">
            {["All", "Low", "Medium", "High"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </Card>

      <DataTable columns={columns} rows={rows} renderCell={(key, row) => {
        if (key === "name") return (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold">{row.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
            <div><p className="font-medium text-brand-ink">{row.name}</p><p className="text-xs text-brand-gray">{row.id}</p></div>
          </div>
        );
        if (key === "risk") return <StatusBadge value={row.risk} />;
        if (key === "status") return <StatusBadge value={row.status} />;
        if (key === "actions") return <button className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline"><Eye className="w-4 h-4" /> View</button>;
        return row[key];
      }} />
      <p className="mt-4 text-sm text-brand-gray">Showing {rows.length} of {residents.length} residents</p>
    </>
  );
}