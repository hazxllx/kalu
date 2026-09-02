import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { appointments } from "@/services/mock/mockData";

const tabs = ["All", "Upcoming", "Completed", "Missed"];

export default function Appointments() {
  const [tab, setTab] = useState("All");
  const rows = appointments.filter((a) => tab === "All" || a.status === tab);

  const columns = [
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
    { key: "service", label: "Service" },
    { key: "place", label: "Location" },
    { key: "status", label: "Status" },
  ];

  return (
    <>
      <PageHeader crumbs={["Home", "Appointments"]} title="Appointments" subtitle="Track your upcoming, completed, and missed visits."
        action={<button className="bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors shadow-soft">Book Appointment</button>} />

      <Card className="p-1.5 inline-flex gap-1 mb-6">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-btn text-sm font-medium transition-colors ${tab === t ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-brand-light"}`}>{t}</button>
        ))}
      </Card>

      <DataTable columns={columns} rows={rows} renderCell={(key, row) => key === "status" ? <StatusBadge value={row.status} /> : row[key]} />
    </>
  );
}