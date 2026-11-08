export const shouldShowReferralDownloadAction = (user) => user?.role !== "mho";

export const REFERRAL_STATUSES = Object.freeze(["Pending", "Accepted", "In Progress", "Completed", "Rejected", "Cancelled"]);
const TRANSITIONS = Object.freeze({
  Pending: ["Accepted", "Rejected", "Cancelled"],
  Accepted: ["In Progress", "Cancelled"],
  "In Progress": ["Completed", "Cancelled"],
  Completed: [], Rejected: [], Cancelled: [],
});

export const referralStatusPermission = (status) => status === "Accepted" ? "referrals.approve" : status === "Rejected" ? "referrals.reject" : "referrals.status.update";

/** The API supplies row-level authority; a role permission alone is not enough. */
export const allowedReferralStatuses = (record, can = () => true) =>
  (record?.capabilities?.allowed_statuses || []).filter((status) =>
    (TRANSITIONS[record?.status] || []).includes(status) && can(referralStatusPermission(status)));

export const canAssignReferral = (record, can = () => true) => Boolean(record?.capabilities?.can_assign && can("referrals.assign"));
export const isOpenReferral = (record) => ["Pending", "Accepted", "In Progress"].includes(record?.status);
export const referralRouteKey = (route) => [route.facility_id, route.role, route.id, route.station || ""].join(":");

export const selectedReferralRoute = (routes, form) => routes.find((route) =>
  route.facility_id === form.recipientFacilityId && route.id === form.recipientPersonnelId
  && route.role === form.recipientRole && (route.station || "") === (form.recipientStation || "")) || null;

export const referralRoleLabel = (role) => ({
  phn: "Public Health Nurse", health_supervisor: "Health Supervisor / Midwife", rhu_personnel: "RHU Personnel",
}[role] || role || "");

export const referralRecipientLabel = (record) => {
  const name = record?.recipient?.full_name || record?.recipientName;
  if (!name || !(record?.recipient_personnel_id || record?.recipientPersonnelId)) return "Unassigned historical referral";
  const role = record.recipient_role || record.recipientRole;
  const station = record.recipient_station || record.recipientStation;
  return [name, referralRoleLabel(role), station && `${station[0].toUpperCase()}${station.slice(1)}`].filter(Boolean).join(" / ");
};
