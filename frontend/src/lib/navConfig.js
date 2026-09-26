/**
 * Sidebar navigation per role.
 *
 * An item may declare an optional `permission` id from `@/lib/permissions`. When
 * it does, the item is only rendered if the signed-in user's role currently
 * holds that permission — so switching a privilege off on the admin's
 * Role & Permissions page immediately removes the corresponding entry point.
 * Items without a `permission` key are always shown, which keeps the existing
 * KALUSAGAP navigation behaviour unchanged.
 *
 * An item may also declare a `group` label. Consecutive items sharing a group
 * are rendered under one small uppercase section header, which keeps longer
 * role menus organized. Items without a group render flat, exactly as before.
 */
export const NAV = {
  "resident-limited": [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/resident-limited/dashboard" },
    { label: "Verification Status", icon: "ShieldCheck", path: "/app/resident-limited/verification" },
    { label: "Health Services", icon: "Stethoscope", path: "/app/resident-limited/services" },
    { label: "Follow-ups", icon: "CalendarClock", path: "/app/resident-limited/follow-ups" },
    { label: "Notifications", icon: "Bell", path: "/app/resident-limited/announcements" },
    { label: "Profile", icon: "User", path: "/app/resident-limited/profile" },
    { label: "Settings", icon: "Settings", path: "/app/resident-limited/settings" },
    { label: "My Health Records", icon: "FileHeart", path: "#", locked: true },
    { label: "Consultation History", icon: "ClipboardList", path: "#", locked: true },
  ],
  resident: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/resident/dashboard" },
    { label: "Verification Status", icon: "ShieldCheck", path: "/app/resident/verification" },
    { label: "My Health Records", icon: "FileHeart", path: "/app/resident/record", permission: "residents.profile.view" },
    { label: "Consultation History", icon: "ClipboardList", path: "/app/resident/consultations", permission: "consultation.history.view" },
    { label: "Follow-ups", icon: "CalendarClock", path: "/app/resident/followups", permission: "followups.view" },
    { label: "Schedule Calendar", icon: "CalendarDays", path: "/app/resident/followup-calendar", permission: "followups.view" },
    { label: "Health Services", icon: "Stethoscope", path: "/app/resident/services" },
    { label: "Notifications", icon: "Bell", path: "/app/resident/notifications" },
    { label: "Settings", icon: "Settings", path: "/app/resident/settings" },
  ],
  // BHW is DATA-COLLECTION ONLY: household profiling and community data
  // gathering. Resident directory, personal clinical records, consultation,
  // referrals, follow-ups and resident verification belong to the Health
  // Supervisor / nurse roles — never the BHW.
  bhw: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/bhw/dashboard" },
    { label: "Household Profiling", icon: "Home", path: "/app/bhw/households" },
    { label: "Household Risk Clusters", icon: "AlertTriangle", path: "/app/bhw/households/risk-clusters" },
    { label: "Notifications", icon: "Bell", path: "/app/bhw/notifications" },
    { label: "Settings", icon: "Settings", path: "/app/bhw/settings" },
  ],
  // Public Health Nurse: triage hand-off check-ups, health records, referrals,
  // follow-ups, health services.
  phn: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/phn/dashboard" },
    { label: "Household Risk Overview", icon: "AlertTriangle", path: "/app/phn/households/risk-overview" },
    { label: "Health Records", icon: "FileHeart", path: "/app/phn/record" },
    { label: "PHN Check-ups", icon: "ClipboardList", path: "/app/phn/consultations", permission: "consultation.requests.view" },
    { label: "Referrals", icon: "Send", path: "/app/phn/referrals", permission: "referrals.view" },
    { label: "Follow-ups", icon: "CalendarClock", path: "/app/phn/followups", permission: "followups.view" },
    { label: "Health Services", icon: "Stethoscope", path: "/app/phn/services" },
    { label: "Community Monitoring", icon: "Map", path: "/app/phn/barangays", permission: "reports.analytics.view" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/phn/certificates" },
    { label: "Reports", icon: "BarChart3", path: "/app/phn/reports", permission: "reports.view" },
    { label: "Notifications", icon: "Bell", path: "/app/phn/notifications" },
    { label: "Settings", icon: "Settings", path: "/app/phn/settings" },
  ],
  // Health Supervisor: barangay-level nurse/midwife. Owns resident
  // verification, resident directory, household verification, health records,
  // consultation, referrals, follow-ups and barangay community monitoring /
  // early warning. The account is assigned to a barangay — its Early Warning
  // module and barangay-sensitive data are scoped to that assignment (see
  // `@/lib/barangayScope` and the API's barangay-scope middleware).
  health_supervisor: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/health_supervisor/dashboard", group: "Main" },
    { label: "Resident Directory", icon: "Users", path: "/app/health_supervisor/residents", permission: "residents.directory.view", group: "Main" },
    { label: "Verifications", icon: "ShieldCheck", path: "/app/health_supervisor/verifications", permission: "residents.registration.approve", group: "Main" },
    { label: "Household Verifications", icon: "Home", path: "/app/health_supervisor/household-verifications", permission: "households.verify", group: "Main" },
    { label: "Consultation", icon: "Stethoscope", path: "/app/health_supervisor/consultations", permission: "consultation.conduct", group: "Health Services" },
    { label: "Records", icon: "ClipboardList", group: "Health Services", children: [
      { label: "TCLS", icon: "ClipboardList", path: "/app/health_supervisor/tcls" },
      { label: "M1", icon: "FileHeart", path: "/app/health_supervisor/m1" },
    ] },
    { label: "Follow-ups", icon: "CalendarClock", path: "/app/health_supervisor/followups", permission: "followups.view", group: "Health Services" },
    { label: "Schedule Calendar", icon: "CalendarDays", path: "/app/health_supervisor/followup-calendar", permission: "followups.view", group: "Health Services" },
    { label: "Health Services", icon: "Activity", path: "/app/health_supervisor/services", group: "Health Services" },
    { label: "Immunization", icon: "Syringe", path: "/app/health_supervisor/immunization", group: "Health Services" },
    { label: "Referrals", icon: "Send", path: "/app/health_supervisor/referrals", permission: "referrals.view", group: "Health Services" },
    { label: "Community Monitoring", icon: "Map", path: "/app/health_supervisor/barangays", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "M1 / Maternal Monitoring", icon: "FileHeart", path: "/app/health_supervisor/m1-report", group: "Monitoring" },
    { label: "Household Risk Clusters", icon: "AlertTriangle", path: "/app/health_supervisor/households/risk-clusters", group: "Monitoring" },
    { label: "Early Warning", icon: "TrendingUp", path: "/app/health_supervisor/trends", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Reports", icon: "BarChart3", path: "/app/health_supervisor/reports", permission: "reports.view", group: "Monitoring" },
    { label: "Notifications", icon: "Bell", path: "/app/health_supervisor/notifications", group: "Account" },
    { label: "Settings", icon: "Settings", path: "/app/health_supervisor/settings", group: "Account" },
  ],
  // RHU Personnel: triage. Dedicated Triage Queue / Triage Assessment screens
  // are pending the verified requirements; monitoring pages remain available.
  // RHU Personnel do not have a Resident Directory entry — residents are owned
  // by the barangay Health Supervisor.
  rhu_personnel: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/rhu_personnel/dashboard" },
    { label: "Triage", icon: "Activity", path: "/app/rhu_personnel/triage", permission: "triage.view" },
    { label: "Referrals", icon: "Send", path: "/app/rhu_personnel/referrals" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/rhu_personnel/certificates" },
    { label: "Health Programs", icon: "HeartPulse", path: "/app/rhu_personnel/programs" },
    { label: "Notifications", icon: "Bell", path: "/app/rhu_personnel/notifications" },
    { label: "Settings", icon: "Settings", path: "/app/rhu_personnel/settings" },
  ],
  mho: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/mho/dashboard", group: "Main" },
    { label: "Health Trends", icon: "TrendingUp", path: "/app/mho/trends", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Household Risk Overview", icon: "AlertTriangle", path: "/app/mho/households/risk-overview", group: "Monitoring" },
    { label: "Community Monitoring", icon: "Map", path: "/app/mho/barangays", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "TCL & M1 Submissions", icon: "ClipboardList", path: "/app/mho/submissions", group: "Submissions" },
    { label: "Referrals", icon: "Send", path: "/app/mho/referrals", permission: "referrals.view", group: "Health Services" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/mho/certificates", group: "Health Services" },
    { label: "Reports", icon: "BarChart3", path: "/app/mho/reports", permission: "reports.view", group: "Reports" },
    { label: "Notifications", icon: "Bell", path: "/app/mho/notifications", group: "Account" },
    { label: "Settings", icon: "Settings", path: "/app/mho/settings", group: "Account" },
  ],
  admin: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/admin/dashboard" },
    { label: "User Management", icon: "Users", path: "/app/admin/users", permission: "accounts.view" },
    { label: "Staff Requests", icon: "ClipboardList", path: "/app/admin/staff-requests", permission: "accounts.view" },
    { label: "Supervisor Verification", icon: "ShieldCheck", path: "/app/admin/supervisor-verifications", permission: "accounts.view" },
    { label: "Early Intervention Rules", icon: "AlertTriangle", path: "/app/admin/risk-rules" },
    { label: "Roles", icon: "Shield", path: "/app/admin/roles" },
    { label: "Role & Permissions", icon: "KeyRound", path: "/app/admin/permissions", permission: "accounts.roles.manage" },
    { label: "Audit Trail", icon: "ScrollText", path: "/app/admin/audit", permission: "system.audit.view" },
    { label: "System Settings", icon: "Settings", path: "/app/admin/settings", permission: "system.settings.manage" },
    { label: "Logs", icon: "Terminal", path: "/app/admin/logs", permission: "system.activity.view" },
  ],
};

/**
 * Drops items whose declared `permission` the current role does not hold.
 * A group is removed once all of its children have been filtered out.
 */
export const filterNavByPermission = (items = [], can) => {
  if (typeof can !== "function") return items;

  return items.reduce((visible, item) => {
    if (item.permission && !can(item.permission)) return visible;

    if (item.children) {
      const children = filterNavByPermission(item.children, can);
      if (children.length === 0) return visible;
      visible.push({ ...item, children });
      return visible;
    }

    visible.push(item);
    return visible;
  }, []);
};
