export const LOGO_URL = new URL("../assets/images/logo.png", import.meta.url).href;

/**
 * KALUSAGAP roles used by the dashboard shell (labels, display name, base path).
 * Keys match the canonical role ids in `@/lib/roles` and the `/app/<key>` route
 * segments so `DashboardLayout` can derive links from the active roleKey.
 *
 * `name` values are placeholder display names for the mock/dev UI only.
 */
export const ROLES = {
  "resident-limited": { key: "resident-limited", label: "Resident (Pending)", name: "Juan Dela Cruz", basePath: "/app/resident-limited" },
  resident: { key: "resident", label: "Resident (Verified)", name: "Maria Santos", basePath: "/app/resident" },
  bhw: { key: "bhw", label: "Barangay Health Worker", name: "Maria Cruz", basePath: "/app/bhw" },
  health_supervisor: { key: "health_supervisor", label: "Health Supervisor", name: "Maria Dela Cruz", basePath: "/app/health_supervisor" },
  phn: { key: "phn", label: "Public Health Nurse", name: "Ana Villanueva", basePath: "/app/phn" },
  rhu_personnel: { key: "rhu_personnel", label: "RHU Personnel", name: "Antonio Reyes", basePath: "/app/rhu_personnel" },
  mho: { key: "mho", label: "Municipal Health Officer", name: "Dr. Carmen Bautista", basePath: "/app/mho" },
  admin: { key: "admin", label: "System Administrator", name: "Jose Ramirez", basePath: "/app/admin" },
};
