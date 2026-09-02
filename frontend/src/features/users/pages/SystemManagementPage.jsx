import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Filter, KeyRound, Search, ShieldCheck } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import Icon from "@/components/common/Icon";
import { usePermissions } from "@/context/PermissionsContext";
import {
  ALL_PERMISSION_IDS,
  MANAGED_ROLES,
  PERMISSION_MODULES,
  ROLE_POLICY,
  countGranted,
  countGrantedInModule,
} from "@/lib/permissions";

const LOGS = [
  { timestamp: "2026-07-07 09:20", user: "Maria Cruz", role: "BHW", action: "Added Consultation", module: "Consultation", status: "Success", ip: "192.168.1.24" },
  { timestamp: "2026-07-07 09:35", user: "Juan Dela Cruz", role: "Resident", action: "Registration Submitted", module: "Registration", status: "Success", ip: "192.168.1.42" },
  { timestamp: "2026-07-07 10:02", user: "Admin System", role: "System Admin", action: "Updated User Role", module: "User Management", status: "Success", ip: "192.168.1.9" },
  { timestamp: "2026-07-07 10:15", user: "Grace Aquino", role: "BHW", action: "Reviewed Verification", module: "Verification", status: "Success", ip: "192.168.1.55" },
  { timestamp: "2026-07-07 10:28", user: "Antonio Reyes", role: "RHU", action: "Submitted Monthly Summary", module: "Reports", status: "Success", ip: "192.168.1.77" },
];

/**
 * Roles overview.
 *
 * Reads the live permission matrix so each role's card reflects exactly what an
 * administrator has granted on the Role & Permissions page — the two screens
 * can never drift apart.
 */
const RolesOverview = () => {
  const { permissionsForRole } = usePermissions();
  const total = ALL_PERMISSION_IDS.length;

  return (
    <>
      <PageHeader
        crumbs={["Home", "Roles"]}
        title="Roles"
        subtitle="System roles, their responsibilities and how much of the permission catalogue each one currently holds."
        action={
          <Link
            to="/app/admin/permissions"
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.9} />
            Manage permissions
          </Link>
        }
      />

      <div className="space-y-4">
        {MANAGED_ROLES.map((role) => {
          const permissions = permissionsForRole(role.id);
          const granted = countGranted(permissions);
          const activeModules = PERMISSION_MODULES.filter(
            (mod) => countGrantedInModule(mod.id, permissions).on > 0,
          );

          return (
            <Card key={role.id} className="p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
                    <Icon name={role.icon} className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading font-semibold text-brand-ink">{role.label}</p>
                      {ROLE_POLICY[role.id] && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-goldpale px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-amber">
                          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                          Guard-railed
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-brand-gray">{role.description}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {activeModules.length === 0 ? (
                        <span className="text-xs text-slate-400">No modules enabled</span>
                      ) : (
                        activeModules.map((mod) => {
                          const { on, total: modTotal } = countGrantedInModule(mod.id, permissions);
                          return (
                            <span
                              key={mod.id}
                              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
                            >
                              {mod.short} <span className="num text-slate-400">{on}/{modTotal}</span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end md:gap-2">
                  <span className="num text-sm text-brand-gray">
                    <span className="font-semibold text-brand-ink">{granted}</span>/{total} permissions
                  </span>
                  <Link
                    to="/app/admin/permissions"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:underline"
                  >
                    Configure
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
};

const SystemLogs = () => (
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

export default function SystemManagementPage({ variant }) {
  if (variant === "roles") return <RolesOverview />;
  return <SystemLogs />;
}
