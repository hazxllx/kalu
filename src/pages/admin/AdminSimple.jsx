import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { Shield, KeyRound, Terminal } from "lucide-react";

const ROLES_DATA = [
  { name: "Resident", users: 12680, perms: "View own records, book appointments" },
  { name: "Barangay Health Worker", users: 48, perms: "Manage residents, households, follow-ups" },
  { name: "Midwife", users: 6, perms: "Consultations, TCLS, M1, referrals" },
  { name: "RHU Personnel", users: 9, perms: "Analytics, reports, all barangays" },
  { name: "Administrator", users: 3, perms: "Full system access" },
];

const PERMS = ["View Records", "Edit Records", "Delete Records", "Manage Users", "Generate Reports", "System Config", "Export Data", "View Audit Trail"];

const LOGS = [
  { level: "INFO", msg: "Scheduled backup completed successfully", time: "09:00:12" },
  { level: "INFO", msg: "User session started — m.cruz@pili.gov.ph", time: "08:47:31" },
  { level: "WARN", msg: "Failed login attempt — unknown@mail.com", time: "08:22:04" },
  { level: "INFO", msg: "Report generated — Immunization Coverage", time: "07:55:18" },
  { level: "ERROR", msg: "Sync retry for offline device DEV-042", time: "07:12:49" },
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
  const tone = { INFO: "text-brand-green", WARN: "text-[#B07E00]", ERROR: "text-brand-danger" };
  return (
    <>
      <PageHeader crumbs={["Home", "Logs"]} title="System Logs" subtitle="Live system event stream." />
      <Card className="p-5 font-mono text-sm bg-brand-ink text-white/90 rounded-card">
        {LOGS.map((l, i) => (
          <div key={i} className="flex gap-3 py-1.5 border-b border-white/10 last:border-0">
            <span className="text-white/50">{l.time}</span>
            <span className={`${tone[l.level]} font-semibold w-14`}>{l.level}</span>
            <span>{l.msg}</span>
          </div>
        ))}
      </Card>
    </>
  );
}