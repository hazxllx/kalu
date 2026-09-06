import React from "react";
import { ChevronRight, ShieldCheck, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLE } from "@/lib/roles";
import { getPHNScope } from "@/lib/phnScope";
import { getSupervisorScope } from "@/lib/supervisorScope";

/** Role badge shown at the top of every role page header. */
const ROLE_BADGES = {
  [ROLE.PHN]: "Public Health Nurse",
  [ROLE.HEALTH_SUPERVISOR]: "Health Supervisor",
  [ROLE.MHO]: "Municipal Health Officer",
  [ROLE.ADMIN]: "System Administrator",
  [ROLE.RHU_PERSONNEL]: "RHU Personnel",
  [ROLE.BHW]: "Barangay Health Worker",
  [ROLE.RESIDENT]: "Resident",
  [ROLE.RESIDENT_LIMITED]: "Resident",
};

const RoleChip = ({ label, coverage = null }) => (
  <div className="flex flex-wrap items-center justify-end gap-2">
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-blue/20 bg-brand-blue/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-blue">
      <ShieldCheck className="h-3 w-3" strokeWidth={2} />
      {label}
    </span>
    {coverage && (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        <MapPin className="h-3 w-3" strokeWidth={2} />
        Coverage: {coverage}
      </span>
    )}
  </div>
);

export default function PageHeader({ crumbs = [], title, subtitle = "", action = null }) {
  const { user, role } = useAuth();
  const roleLabel = ROLE_BADGES[role];

  let coverage = null;
  if (role === ROLE.PHN) {
    const phnScope = getPHNScope(user);
    coverage = phnScope && phnScope.level === "barangay" ? phnScope.assignedBarangay : "RHU";
  } else if (role === ROLE.HEALTH_SUPERVISOR) {
    const supervisorScope = getSupervisorScope(user);
    coverage = supervisorScope?.assignedBarangay || null;
  }

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-card md:px-6">
      <div className="flex items-start justify-between gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-slate-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={i === crumbs.length - 1 ? "text-brand-blue font-semibold" : ""}>{c}</span>
            </span>
          ))}
        </nav>
        {roleLabel && <RoleChip label={roleLabel} coverage={coverage} />}
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
