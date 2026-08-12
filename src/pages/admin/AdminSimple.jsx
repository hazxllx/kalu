import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { Shield, KeyRound, Search, Download, Filter } from "lucide-react";

const ROLES_DATA = [
  { name: "Resident", users: 12680, perms: "View own records, book appointments" },
  { name: "Barangay Health Worker", users: 48, perms: "Manage residents, households, follow-ups" },
  { name: "Midwife", users: 6, perms: "Consultations, TCLS, M1, referrals" },
  { name: "RHU Personnel", users: 9, perms: "Record consultations, treatments, referrals, follow-ups" },
  { name: "Administrator", users: 3, perms: "Full system access" },
];

const PERMS = ["View Records", "Edit Records", "Delete Records", "Manage Users", "Generate Reports", "System Config", "Export Data", "View Audit Trail"];

const LOGS = [
  { timestamp: "2026-07-07 09:20", user: "Maria Cruz", role: "BHW", action: "Added Consultation", module: "Consultation", status: "Success", ip: "192.168.1.24" },
  { timestamp: "2026-07-07 09:35", user: "Juan Dela Cruz", role: "Resident", action: "Registration Submitted", module: "Registration", status: "Success", ip: "192.168.1.42" },
  { timestamp: "2026-07-07 10:02", user: "Admin System", role: "System Admin", action: "Updated User Role", module: "User Management", status: "Success", ip: "192.168.1.9" },
  { timestamp: "2026-07-07 10:15", user: "Grace Aquino", role: "BHW", action: "Reviewed Verification", module: "Verification", status: "Success", ip: "192.168.1.55" },
  { timestamp: "2026-07-07 10:28", user: "Antonio Reyes", role: "RHU", action: "Submitted Monthly Summary", module: "Reports", status: "Success", ip: "192.168.1.77" },
];

export default function AdminSimple({ variant }) {
  if (variant === "roles") {
    return (
      <>
        <PageHeader crumbs={["Home", "Roles"]} title="Roles" subtitle="System roles and their responsibilities." />
        <div className="space-y-4">
          {ROLES_DATA.map((r) => (
            <Card key={r.name} className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><Shield className="w-5 h-5" /></div>
                <div><p className="font-semibold text-brand-ink">{r.name}</p><p className="text-sm text-brand-gray">{r.perms}</p></div>
              </div>
              <span className="text-sm text-brand-gray">{r.users.toLocaleString()} users</span>
            </Card>
          ))}
        </div>
      </>
    );
  }

  if (variant === "permissions") {
    return (
      <>
        <PageHeader crumbs={["Home", "Permissions"]} title="Permissions" subtitle="Configure access rights per role." />
        <Card className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b border-brand-border">
              <th className="py-3 font-semibold text-brand-gray">Permission</th>
              {["BHW", "Midwife", "RHU", "Admin"].map((r) => <th key={r} className="py-3 font-semibold text-brand-gray text-center">{r}</th>)}
            </tr></thead>
            <tbody>
              {PERMS.map((p, i) => (
                <tr key={p} className="border-b border-brand-border last:border-0">
                  <td className="py-3.5 text-brand-ink flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-gray" /> {p}</td>
                  {[0,1,2,3].map((c) => (
                    <td key={c} className="text-center">
                      <input type="checkbox" defaultChecked={c === 3 || (i < 5 && c >= 1) || (i < 2)} className="rounded border-brand-border text-brand-blue" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </>
    );
  }

  // logs
  return (
    <>
      <PageHeader crumbs={["Home", "Logs"]} title="System Logs" subtitle="Review recent administrator and user activity." />
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 w-full md:max-w-sm">
            <Search className="w-4 h-4 text-brand-gray" />
            <input placeholder="Search logs" className="bg-transparent text-sm outline-none w-full" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5">
              <Filter className="w-4 h-4 text-brand-gray" />
              <select className="bg-transparent text-sm outline-none">
                <option>All Status</option>
                <option>Success</option>
                <option>Failed</option>
              </select>
            </div>
            <button className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors">
              <Download className="w-4 h-4" /> Export Logs
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-brand-border text-brand-gray">
                <th className="py-3 pr-3">Timestamp</th>
                <th className="py-3 pr-3">User</th>
                <th className="py-3 pr-3">Role</th>
                <th className="py-3 pr-3">Action</th>
                <th className="py-3 pr-3">Module</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {LOGS.map((log, i) => (
                <tr key={i} className="border-b border-brand-border last:border-0">
                  <td className="py-3 pr-3 text-brand-ink">{log.timestamp}</td>
                  <td className="py-3 pr-3 text-brand-ink">{log.user}</td>
                  <td className="py-3 pr-3 text-brand-gray">{log.role}</td>
                  <td className="py-3 pr-3 text-brand-ink">{log.action}</td>
                  <td className="py-3 pr-3 text-brand-gray">{log.module}</td>
                  <td className="py-3 pr-3"><span className="text-xs text-brand-green bg-brand-green/10 px-2 py-1 rounded-full">{log.status}</span></td>
                  <td className="py-3 text-brand-gray">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-brand-gray">
          <span>Showing 5 of 5 entries</span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-btn border border-brand-border hover:bg-brand-bg">Previous</button>
            <button className="px-3 py-1.5 rounded-btn border border-brand-border hover:bg-brand-bg">Next</button>
          </div>
        </div>
      </Card>
    </>
  );
}