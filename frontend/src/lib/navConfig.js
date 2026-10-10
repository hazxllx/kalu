/**
 * Sidebar navigation per role.
 *
 * An item may declare `permission` or `anyPermissions` ids from
 * `@/lib/permissions`. Items with permission requirements are only rendered
 * when the signed-in user's role currently holds the required permission(s).
 *
 * An item may also declare a `group` label. Consecutive items sharing a group
 * are rendered under one small uppercase section header. Items with `children`
 * render as expandable navigation groups; child permissions are filtered in
 * the same way as top-level items. Hidden items preserve route permission
 * mappings without appearing in the sidebar.
 */
export const NAV = {
  "resident-limited": [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/resident-limited/dashboard",
    },
    {
      label: "Verification Status",
      icon: "ShieldCheck",
      path: "/app/resident-limited/verification",
    },
    {
      label: "Health Services",
      icon: "Stethoscope",
      path: "/app/resident-limited/services",
    },
    {
      label: "Follow-ups",
      icon: "CalendarClock",
      path: "/app/resident-limited/follow-ups",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/resident-limited/announcements",
    },
    {
      label: "Profile",
      icon: "User",
      path: "/app/resident-limited/profile",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/resident-limited/settings",
    },
    {
      label: "My Health Records",
      icon: "FileHeart",
      path: "#",
      locked: true,
    },
    {
      label: "Consultation History",
      icon: "ClipboardList",
      path: "#",
      locked: true,
    },
  ],

  resident: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/resident/dashboard",
    },
    {
      label: "Verification Status",
      icon: "ShieldCheck",
      path: "/app/resident/verification",
    },
    {
      label: "My Health Records",
      icon: "FileHeart",
      path: "/app/resident/record",
      permission: "residents.profile.view",
    },
    {
      label: "Consultation History",
      icon: "ClipboardList",
      path: "/app/resident/consultations",
      permission: "consultation.history.view",
    },
    {
      label: "Follow-ups",
      icon: "CalendarClock",
      path: "/app/resident/followups",
      permission: "followups.view",
    },
    {
      label: "Health Services",
      icon: "Stethoscope",
      path: "/app/resident/services",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/resident/notifications",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/resident/settings",
    },
  ],

  // BHW is DATA-COLLECTION ONLY: household profiling and community data
  // gathering. Resident directory, personal clinical records, consultation,
  // referrals, follow-ups and resident verification belong to the Health
  // Supervisor / nurse roles — never the BHW.
  bhw: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/bhw/dashboard",
    },
    {
      label: "Household Profiling",
      icon: "Home",
      path: "/app/bhw/households",
      permission: "households.view",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/bhw/notifications",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/bhw/settings",
    },
  ],

  // Public Health Nurse navigation keeps the dashboard and resident directory
  // visible, with the remaining clinical destinations organized into
  // collapsible groups. Every existing route and permission remains unchanged.
  phn: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/phn/dashboard",
    },
    {
      label: "Resident Directory",
      icon: "Users",
      path: "/app/phn/residents",
      permission: "residents.directory.view",
    },
    {
      label: "Clinical Care",
      icon: "HeartPulse",
      children: [
        {
          label: "Health Records",
          icon: "FileHeart",
          path: "/app/phn/record",
          permission: "residents.profile.view",
        },
        {
          label: "TCL",
          icon: "ClipboardList",
          path: "/app/phn/tcls",
        },
        {
          label: "PHN Check-ups",
          icon: "ClipboardList",
          path: "/app/phn/consultations",
          permission: "consultation.requests.view",
        },
        {
          label: "Health Services",
          icon: "Stethoscope",
          path: "/app/phn/services",
          permission: "services.view",
        },
        { label: "Program Enrollment Register", path: "/app/phn/tcl-register", hidden: true },
      ],
    },
    {
      label: "Care Coordination",
      icon: "HeartHandshake",
      children: [
        {
          label: "Referrals",
          icon: "Send",
          path: "/app/phn/referrals",
          permission: "referrals.view",
        },
        {
          label: "Follow-ups",
          icon: "CalendarClock",
          path: "/app/phn/followups",
          permission: "followups.view",
        },
      ],
    },
    {
      label: "Community Risk",
      icon: "AlertTriangle",
      children: [
        {
          label: "Household Risk Overview",
          icon: "Home",
          path: "/app/phn/households/risk-overview",
          activePaths: ["/app/phn/households"],
          permission: "households.view",
        },
      ],
    },
    {
      label: "Documents & Reports",
      icon: "FileText",
      children: [
        {
          label: "Medical Certificates",
          icon: "FileText",
          path: "/app/phn/certificates",
        },
        {
          label: "Reports",
          icon: "BarChart3",
          path: "/app/phn/reports",
          permission: "reports.view",
        },
      ],
    },
    {
      label: "Account Approvals",
      icon: "ShieldCheck",
      path: "/app/phn/account-approvals",
      permission: "accounts.personnel.approve",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/phn/notifications",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/phn/settings",
    },
  ],

  // Health Supervisor: barangay-level nurse/midwife. Owns resident
  // verification, resident directory, household verification, health records,
  // consultation, referrals, follow-ups and barangay community monitoring /
  // early warning. The account is assigned to a barangay — its Early Warning
  // module and barangay-sensitive data are scoped to that assignment (see
  // `@/lib/barangayScope` and the API's barangay-scope middleware).
  health_supervisor: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/health_supervisor/dashboard",
      group: "Main",
    },
    {
      label: "Resident Directory",
      icon: "Users",
      path: "/app/health_supervisor/residents",
      permission: "residents.directory.view",
      group: "Main",
    },
    {
      label: "Health Services",
      icon: "Stethoscope",
      group: "Health Operations",
      children: [
        {
          label: "Consultation",
          icon: "Stethoscope",
          path: "/app/health_supervisor/consultations",
          permission: "consultation.requests.view",
        },
        {
          label: "Records",
          icon: "ClipboardList",
          children: [
            {
              label: "TCL",
              icon: "ClipboardList",
              path: "/app/health_supervisor/tcls",
            },
            {
              label: "M1",
              icon: "FileHeart",
              path: "/app/health_supervisor/m1",
            },
            {
              label: "Immunization",
              icon: "Syringe",
              path: "/app/health_supervisor/immunization",
            },
            {
              label: "TB Records",
              icon: "Activity",
              path: "/app/health_supervisor/tb",
            },
            { label: "Program Enrollment Register", path: "/app/health_supervisor/tcl-register", hidden: true },
          ],
        },
        {
          label: "Referrals",
          icon: "Send",
          path: "/app/health_supervisor/referrals",
          permission: "referrals.view",
        },
        {
          label: "Health Services / Programs",
          icon: "Activity",
          path: "/app/health_supervisor/services",
          permission: "services.view",
        },
      ],
    },
    {
      label: "Monitoring & Reports",
      icon: "TrendingUp",
      group: "Monitoring",
      children: [
        {
          label: "Early Warning",
          icon: "TrendingUp",
          path: "/app/health_supervisor/trends",
          permission: "reports.analytics.view",
        },
        {
          label: "Reports",
          icon: "BarChart3",
          path: "/app/health_supervisor/reports",
          permission: "reports.view",
        },
      ],
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/health_supervisor/notifications",
      group: "Account",
    },
    {
      label: "Verifications & Approvals",
      icon: "ShieldCheck",
      path: "/app/health_supervisor/verifications",
      anyPermissions: [
        "residents.registration.approve",
        "households.verify",
        "accounts.personnel.approve",
      ],
      hidden: true,
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/health_supervisor/settings",
      hidden: true,
    },
  ],

  // RHU Personnel navigation is limited to their operational workspace.
  //
  // RHU Personnel uses ONE account for both the triage and consultation
  // stations. The workflow is:
  // RHU Triage -> RHU Consultation -> Findings/Assessment.
  rhu_personnel: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/rhu_personnel/dashboard",
      group: "Main",
    },
    {
      label: "Triage",
      icon: "Activity",
      path: "/app/rhu_personnel/triage",
      permission: "triage.view",
      group: "Operations",
    },
    {
      label: "Consultation",
      icon: "Stethoscope",
      path: "/app/rhu_personnel/consultation",
      permission: "consultation.requests.view",
      group: "Operations",
    },
    {
      label: "Medical Certificates",
      icon: "FileText",
      path: "/app/rhu_personnel/certificates",
      group: "Operations",
    },
    {
      label: "Health Programs",
      icon: "HeartPulse",
      path: "/app/rhu_personnel/programs",
      group: "Operations",
    },
    {
      label: "Incoming Reports",
      icon: "ClipboardList",
      path: "/app/rhu_personnel/reports",
      permission: "reports.view",
      group: "Operations",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/rhu_personnel/notifications",
      group: "Operations",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/rhu_personnel/settings",
      group: "System",
    },
  ],

  mho: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/mho/dashboard",
      group: "Main",
    },
    {
      label: "Resident Directory",
      icon: "Users",
      path: "/app/mho/residents",
      permission: "residents.directory.view",
      group: "Main",
    },
    {
      label: "Health Trends",
      icon: "TrendingUp",
      path: "/app/mho/trends",
      permission: "reports.analytics.view",
      group: "Monitoring",
    },
    {
      label: "Referrals",
      icon: "Send",
      path: "/app/mho/referrals",
      permission: "referrals.view",
      group: "Monitoring",
    },
    {
      label: "TCL & M1 Submissions",
      icon: "ClipboardList",
      path: "/app/mho/submissions",
      group: "Submissions",
    },
    {
      label: "Medical Certificates",
      icon: "FileText",
      path: "/app/mho/certificates",
      group: "Health Services",
    },
    {
      label: "Reports",
      icon: "BarChart3",
      path: "/app/mho/reports",
      permission: "reports.view",
      group: "Reports",
    },
    {
      label: "Notifications",
      icon: "Bell",
      path: "/app/mho/notifications",
      group: "Account",
    },
    {
      label: "Settings",
      icon: "Settings",
      path: "/app/mho/settings",
      group: "Account",
    },
  ],

  admin: [
    {
      label: "Dashboard",
      icon: "LayoutDashboard",
      path: "/app/admin/dashboard",
      group: "Overview",
    },
    {
      label: "User Management",
      icon: "Users",
      path: "/app/admin/users",
      permission: "accounts.view",
      group: "Management",
    },
    {
      label: "Roles",
      icon: "Shield",
      path: "/app/admin/roles",
      permission: "accounts.roles.manage",
      group: "Management",
    },
    {
      label: "Role & Permissions",
      icon: "KeyRound",
      path: "/app/admin/permissions",
      permission: "accounts.roles.manage",
      group: "Management",
    },
    {
      label: "Early Intervention Rules",
      icon: "AlertTriangle",
      path: "/app/admin/risk-rules",
      permission: "system.settings.manage",
      group: "Health Configuration",
    },
    {
      label: "Risk Assessment",
      icon: "ShieldAlert",
      path: "/app/admin/risk-assessment",
      permission: "system.settings.manage",
      group: "Health Configuration",
    },
    {
      label: "Audit Trail",
      icon: "ScrollText",
      path: "/app/admin/audit",
      permission: "system.audit.view",
      group: "System",
    },
    {
      label: "System Settings",
      icon: "Settings",
      path: "/app/admin/settings",
      permission: "system.settings.manage",
      group: "System",
    },
    {
      label: "Logs",
      icon: "Terminal",
      path: "/app/admin/logs",
      permission: "system.activity.view",
      group: "System",
    },
  ],
};

export const profilePathForRole = (roleKey) =>
  `/app/${roleKey}/profile`;

export const navItemIsActive = (item, pathname) => {
  const paths = [item.path, ...(item.activePaths || [])].filter(
    (path) => path && path !== "#",
  );

  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
};

/**
 * Drops items whose declared `permission` the current role does not hold.
 * A group is removed once all of its children have been filtered out.
 */
export const filterNavByPermission = (items = [], can) => {
  if (typeof can !== "function") return items;

  return items.reduce((visible, item) => {
    if (item.permission && !can(item.permission)) {
      return visible;
    }
    if (item.anyPermissions?.length && !item.anyPermissions.some((permission) => can(permission))) {
      return visible;
    }

    if (item.children) {
      const children = filterNavByPermission(item.children, can);

      if (children.length === 0) {
        return visible;
      }

      visible.push({
        ...item,
        children,
      });

      return visible;
    }

    visible.push(item);
    return visible;
  }, []);
};

/**
 * Resolve the permission requirement for a visible navigation path. The same
 * mapping guards direct URL visits inside DashboardLayout.
 */
export const navPermissionsForPath = (items = [], pathname) => {
  for (const item of items) {
    if (item.children) {
      const childPermissions = navPermissionsForPath(item.children, pathname);
      if (childPermissions) return childPermissions;
    }

    if (navItemIsActive(item, pathname)) {
      if (item.permission) return [item.permission];
      if (item.anyPermissions?.length) return item.anyPermissions;
      return null;
    }
  }
  return null;
};