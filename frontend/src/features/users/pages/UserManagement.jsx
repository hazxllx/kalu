import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { Search, UserPlus } from "lucide-react";
import { systemUsers } from "@/services/mock/mockData";

export default function UserManagement() {
  const [q, setQ] = useState("");
  const rows = systemUsers.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.role.toLowerCase().includes(q.toLowerCase()));
  const columns = [
    { key: "name", label: "User" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "barangay", label: "Barangay" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "User Management"]} title="User Management" subtitle="Manage system users, roles, and access."
        action={<button className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><UserPlus className="w-4 h-4" /> Add User</button>} />
      <Card className="p-4 mb-5">
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
          <Search className="w-4 h-4 text-brand-gray" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users or roles..." className="bg-transparent text-sm outline-none w-full" />
        </div>
      </Card>
      <DataTable columns={columns} rows={rows} renderCell={(key, row) => {
        if (key === "name") return (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold">{row.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
            <span className="font-medium text-brand-ink">{row.name}</span>
          </div>
        );
        if (key === "status") return <StatusBadge value={row.status} />;
        if (key === "actions") return (
          <div className="flex gap-2">
            <button className="text-brand-blue text-sm font-medium hover:underline">Edit</button>
            <button className="text-brand-danger text-sm font-medium hover:underline">Disable</button>
          </div>
        );
        return row[key];
      }} />
    </>
  );
}