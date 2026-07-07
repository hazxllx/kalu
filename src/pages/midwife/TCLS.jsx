import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/Badge";
import { Card } from "@/components/shared/Card";
import { tclsRecords } from "@/lib/mockData";

const categories = ["All", "Pregnant Women", "Senior Citizens", "Diabetes", "Family Planning", "TB Patients"];

export default function TCLS() {
  const [cat, setCat] = useState("All");
  const rows = tclsRecords.filter((r) => cat === "All" || r.program === cat);
  const columns = [
    { key: "resident", label: "Resident" },
    { key: "program", label: "Program" },
    { key: "bhw", label: "Assigned BHW" },
    { key: "lastVisit", label: "Last Visit" },
    { key: "nextVisit", label: "Next Visit" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "TCLS"]} title="Target Client List" subtitle="Residents enrolled in community health programs." />
      <div className="flex flex-wrap gap-2 mb-5">
        {categories.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${cat === c ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-brand-gray border-brand-border hover:border-brand-blue"}`}>{c}</button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} renderCell={(key, row) => {
        if (key === "priority") return <StatusBadge value={row.priority} />;
        if (key === "status") return <StatusBadge value={row.status} />;
        if (key === "actions") return (
          <div className="flex gap-2">
            <button className="text-brand-blue text-sm font-medium hover:underline">View</button>
            <button className="text-brand-green text-sm font-medium hover:underline">Schedule</button>
          </div>
        );
        return row[key];
      }} />
    </>
  );
}