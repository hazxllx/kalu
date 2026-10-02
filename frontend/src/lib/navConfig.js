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
    { label: "Notifications", icon: "Bell", path: "/app/bhw/notifications" },
    { label: "Settings", icon: "Settings", path: "/app/bhw/settings" },
  ],
  // Public Health Nurse: triage hand-off check-ups, health records, referrals,
  // follow-ups, health services. Grouped into functional categories (the
  // DashboardLayout renders consecutive shared-group items under one small,
  // non-clickable section label). Settings is kept under System so no existing
  // PHN entry point is removed.
  phn: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/phn/dashboard", group: "Overview" },
    { label: "Resident Directory", icon: "Users", path: "/app/phn/residents", group: "Patient & Community Care" },
    { label: "Health Records", icon: "FileHeart", path: "/app/phn/record", group: "Patient & Community Care" },
    { label: "PHN Check-ups", icon: "ClipboardList", path: "/app/phn/consultations", permission: "consultation.requests.view", group: "Patient & Community Care" },
    { label: "Health Services", icon: "Stethoscope", path: "/app/phn/services", group: "Patient & Community Care" },
    { label: "Referrals", icon: "Send", path: "/app/phn/referrals", permission: "referrals.view", group: "Care Coordination" },
    { label: "Follow-ups", icon: "CalendarClock", path: "/app/phn/followups", permission: "followups.view", group: "Care Coordination" },
    { label: "Household Risk Overview", icon: "AlertTriangle", path: "/app/phn/households/risk-overview", group: "Risk & Monitoring" },
    { label: "Community Monitoring", icon: "Map", path: "/app/phn/barangays", permission: "reports.analytics.view", group: "Risk & Monitoring" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/phn/certificates", group: "Documents & Reports" },
    { label: "Account Approvals", icon: "ShieldCheck", path: "/app/phn/account-approvals", group: "Documents & Reports" },
    { label: "Reports", icon: "BarChart3", path: "/app/phn/reports", permission: "reports.view", group: "Documents & Reports" },
    { label: "Notifications", icon: "Bell", path: "/app/phn/notifications", group: "System" },
    { label: "Settings", icon: "Settings", path: "/app/phn/settings", group: "System" },
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
    { label: "Resident Verifications", icon: "ShieldCheck", path: "/app/health_supervisor/verifications", permission: "residents.registration.approve", group: "Verification & Approvals" },
    { label: "Household Verifications", icon: "Home", path: "/app/health_supervisor/household-verifications", permission: "households.verify", group: "Verification & Approvals" },
    { label: "Account Approvals", icon: "ShieldCheck", path: "/app/health_supervisor/account-approvals", group: "Verification & Approvals" },
    { label: "Consultation", icon: "Stethoscope", path: "/app/health_supervisor/consultations", permission: "consultation.conduct", group: "Health Services" },
    { label: "Records", icon: "ClipboardList", group: "Health Services", children: [
      { label: "TCL", icon: "ClipboardList", path: "/app/health_supervisor/tcls" },
      { label: "M1", icon: "FileHeart", path: "/app/health_supervisor/m1" },
      { label: "Immunization", icon: "Syringe", path: "/app/health_supervisor/immunization" },
      { label: "TB Records", icon: "Activity", path: "/app/health_supervisor/tb" },
      { label: "Follow-ups", icon: "CalendarClock", path: "/app/health_supervisor/followups", permission: "followups.view" },
    ] },
    { label: "Schedule Calendar", icon: "CalendarDays", path: "/app/health_supervisor/followup-calendar", permission: "followups.view", group: "Health Services" },
    { label: "Health Services", icon: "Activity", path: "/app/health_supervisor/services", group: "Health Services" },
    { label: "Referrals", icon: "Send", path: "/app/health_supervisor/referrals", permission: "referrals.view", group: "Health Services" },
    { label: "Community Monitoring", icon: "Map", path: "/app/health_supervisor/barangays", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Early Warning", icon: "TrendingUp", path: "/app/health_supervisor/trends", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Reports", icon: "BarChart3", path: "/app/health_supervisor/reports", permission: "reports.view", group: "Monitoring" },
    { label: "Notifications", icon: "Bell", path: "/app/health_supervisor/notifications", group: "Account" },
    { label: "Settings", icon: "Settings", path: "/app/health_supervisor/settings", group: "Account" },
  ],
  // RHU Personnel navigation is limited to their operational workspace.
  rhu_personnel: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/rhu_personnel/dashboard", group: "Main" },
    { label: "Triage", icon: "Activity", path: "/app/rhu_personnel/triage", permission: "triage.view", group: "Operations" },
    { label: "Consultation", icon: "Stethoscope", path: "/app/rhu_personnel/consultation", permission: "consultation.requests.view", group: "Operations" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/rhu_personnel/certificates", group: "Operations" },
    { label: "Health Programs", icon: "HeartPulse", path: "/app/rhu_personnel/programs", group: "Operations" },
    { label: "Notifications", icon: "Bell", path: "/app/rhu_personnel/notifications", group: "Operations" },
    { label: "Settings", icon: "Settings", path: "/app/rhu_personnel/settings", group: "System" },
  ],
  mho: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/mho/dashboard", group: "Main" },
    { label: "Resident Directory", icon: "Users", path: "/app/mho/residents", group: "Main" },
    { label: "Health Trends", icon: "TrendingUp", path: "/app/mho/trends", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Community Monitoring", icon: "Map", path: "/app/mho/barangays", permission: "reports.analytics.view", group: "Monitoring" },
    { label: "Referrals", icon: "Send", path: "/app/mho/referrals", permission: "referrals.view", group: "Monitoring" },
    { label: "TCL & M1 Submissions", icon: "ClipboardList", path: "/app/mho/submissions", group: "Submissions" },
    { label: "Medical Certificates", icon: "FileText", path: "/app/mho/certificates", group: "Health Services" },
    { label: "Reports", icon: "BarChart3", path: "/app/mho/reports", permission: "reports.view", group: "Reports" },
    { label: "Notifications", icon: "Bell", path: "/app/mho/notifications", group: "Account" },
    { label: "Settings", icon: "Settings", path: "/app/mho/settings", group: "Account" },
  ],
  admin: [
    { label: "Dashboard", icon: "LayoutDashboard", path: "/app/admin/dashboard" },
    { label: "User Management", icon: "Users", path: "/app/admin/users", permission: "accounts.view" },
    { label: "Early Intervention Rules", icon: "AlertTriangle", path: "/app/admin/risk-rules" },
    { label: "Risk Assessment", icon: "ShieldAlert", path: "/app/admin/risk-assessment" },
    { label: "Roles", icon: "Shield", path: "/app/admin/roles" },
    { label: "Role & Permissions", icon: "KeyRound", path: "/app/admin/permissions", permission: "accounts.roles.manage" },
    { label: "Audit Trail", icon: "ScrollText", path: "/app/admin/audit", permission: "system.audit.view" },
    { label: "System Settings", icon: "Settings", path: "/app/admin/settings", permission: "system.settings.manage" },
    { label: "Logs", icon: "Terminal", path: "/app/admin/logs", permission: "system.activity.view" },
  ],
};

export const profilePathForRole = (roleKey) => `/app/${roleKey}/profile`;

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
