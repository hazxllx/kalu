import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Download } from "lucide-react";
import { auditLogs } from "@/lib/mockData";

export default function AuditTrail() {
  const columns = [
    { key: "time", label: "Timestamp" },
    { key: "user", label: "User" },
    { key: "role", label: "Role" },
    { key: "action", label: "Action" },
    { key: "ip", label: "IP Address" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "Audit Trail"]} title="Audit Trail" subtitle="Complete record of system activity and changes."
        action={<button className="flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-ink hover:border-brand-blue transition-colors"><Download className="w-4 h-4" /> Export Logs</button>} />
      <DataTable columns={columns} rows={auditLogs} renderCell={(key, row) =>
        key === "ip" ? <span className="font-mono text-xs text-brand-gray">{row.ip}</span> : row[key]} />
    </>
  );
}