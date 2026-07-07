import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/Badge";
import { Card } from "@/components/shared/Card";
import { followUps } from "@/lib/mockData";

const tabs = ["All", "Today", "Upcoming", "Completed", "Missed"];

export default function FollowUpPage() {
  const [tab, setTab] = useState("All");
  const rows = followUps.filter((f) => tab === "All" || f.status === tab);
  const columns = [
    { key: "resident", label: "Resident" },
    { key: "purpose", label: "Purpose" },
    { key: "personnel", label: "Assigned" },
    { key: "location", label: "Location" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "Follow-ups"]} title="Follow-ups" subtitle="Manage today's visits, upcoming schedules, and outcomes." />
      <Card className="p-1.5 inline-flex gap-1 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-btn text-sm font-medium transition-colors ${tab === t ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-brand-light"}`}>{t}</button>
        ))}
      </Card>
      <DataTable columns={columns} rows={rows} renderCell={(key, row) => {
        if (key === "priority") return <StatusBadge value={row.priority} />;
        if (key === "status") return <StatusBadge value={row.status} />;
        if (key === "actions") return (
          <div className="flex gap-2">
            <button className="text-brand-green text-sm font-medium hover:underline">Complete</button>
            <button className="text-brand-blue text-sm font-medium hover:underline">Reschedule</button>
          </div>
        );
        return row[key];
      }} />
    </>
  );
}