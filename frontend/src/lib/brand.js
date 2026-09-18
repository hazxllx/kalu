export const LOGO_URL = new URL("../assets/images/logo.png", import.meta.url).href;

/**
 * KALUSAGAP roles used by the dashboard shell (labels, display name, base path).
 * Keys match the canonical role ids in `@/lib/roles` and the `/app/<key>` route
 * segments so `DashboardLayout` can derive links from the active roleKey.
 *
 * `name` is a role-neutral fallback label, used only when the signed-in account
 * does not provide its own name. It is never a placeholder person.
 */
export const ROLES = {
  "resident-limited": { key: "resident-limited", label: "Resident (Pending)", name: "Resident (Pending)", basePath: "/app/resident-limited" },
  resident: { key: "resident", label: "Resident (Verified)", name: "Resident (Verified)", basePath: "/app/resident" },
  bhw: { key: "bhw", label: "Barangay Health Worker", name: "Barangay Health Worker", basePath: "/app/bhw" },
  health_supervisor: { key: "health_supervisor", label: "Barangay Health Supervisor", name: "Health Supervisor", basePath: "/app/health_supervisor" },
  phn: { key: "phn", label: "Public Health Nurse", name: "Public Health Nurse", basePath: "/app/phn" },
  rhu_personnel: { key: "rhu_personnel", label: "RHU Personnel", name: "RHU Personnel", basePath: "/app/rhu_personnel" },
  mho: { key: "mho", label: "Municipal Health Officer", name: "Municipal Health Officer", basePath: "/app/mho" },
  admin: { key: "admin", label: "System Administrator", name: "System Administrator", basePath: "/app/admin" },
};
