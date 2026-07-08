import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/Badge";
import StatCard from "@/components/shared/StatCard";
import { immunizations } from "@/lib/mockData";

const stats = [
  { icon: "Syringe", label: "Children Due", value: "12", tone: "accent" },
  { icon: "CalendarCheck", label: "Upcoming Sessions", value: "3", tone: "blue" },
  { icon: "AlertTriangle", label: "Missed Vaccinations", value: "5", tone: "danger" },
  { icon: "Activity", label: "Coverage Rate", value: "91%", tone: "green" },
];

export default function Immunization() {
  const columns = [
    { key: "child", label: "Child" },
    { key: "vaccine", label: "Vaccine" },
    { key: "completed", label: "Completed Doses" },
    { key: "nextDose", label: "Next Dose" },
    { key: "status", label: "Status" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "Immunization"]} title="Immunization" subtitle="Vaccination schedules, coverage, and resident history." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>
      <DataTable columns={columns} rows={immunizations} renderCell={(key, row) =>
        key === "status" ? <StatusBadge value={row.status} /> : row[key]} />
    </>
  );
}