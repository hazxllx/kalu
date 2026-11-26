// frontend/src/features/follow-ups/lib/residentFollowUpPresentation.js
import { manilaDateKey } from "./scheduleDates.js";

const ACTIVE_STATUSES = new Set(["pending", "scheduled", "today", "upcoming", "ongoing"]);
const RESPONSE_STATUSES = new Set(["pending", "scheduled", "today", "upcoming"]);

const normalized = (value) => String(value || "").trim().toLowerCase();
const dateKey = (value) => {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
};

// Handles getResidentFollowUpPresentation logic.
export function getResidentFollowUpPresentation(row = {}, now = new Date()) {
  const status = normalized(row.status);
  const confirmation = normalized(row.scheduleResponseStatus || row.confirmationStatus);
  const scheduledDate = dateKey(row.scheduledDate);
  const today = manilaDateKey(now);
  const active = ACTIVE_STATUSES.has(status);
  const overdue = active && Boolean(scheduledDate) && scheduledDate < today;
  const defaultConfirmed = ["default confirmed", "confirmed by default"].includes(confirmation);
  const residentResponseRequired = active && !overdue && ["awaiting response", "awaiting confirmation"].includes(confirmation);
  const pendingScheduleReview = Boolean(active && (
    confirmation === "reschedule requested" || confirmation === "cancellation requested"
  ));
  const confirmed = active && (defaultConfirmed || [
    "confirmed", "attendance confirmed", "confirmed by default", "reschedule approved",
    "reschedule rejected", "cancellation rejected",
  ].includes(confirmation));

  let statusLabel = "Scheduled";
  let statusDetail = "";
  let category = "actionRequired";

  if (status === "completed") {
    statusLabel = "Completed";
    category = "completed";
  } else if (confirmation === "rejected" || status === "rejected") {
    statusLabel = "Rejected";
    category = "cancelled";
  } else if (status === "cancelled") {
    statusLabel = "Cancelled";
    category = "cancelled";
  } else if (status === "missed") {
    statusLabel = "Missed";
    statusDetail = "Attendance was not recorded";
  } else if (residentResponseRequired) {
    statusLabel = "Awaiting Response";
    statusDetail = "Please confirm whether you can attend";
  } else if (overdue) {
    statusLabel = "Overdue";
    statusDetail = pendingScheduleReview
      ? "A schedule change request is awaiting staff review"
      : confirmation === "awaiting confirmation"
        ? "Awaiting resident confirmation · attendance not recorded"
        : confirmed
          ? "Confirmed · attendance not recorded"
          : "Appointment date passed";
  } else if (pendingScheduleReview) {
    statusLabel = confirmation === "reschedule requested" ? "Reschedule Requested" : "Cancellation Requested";
  } else if (confirmed) {
    statusLabel = "Confirmed";
  } else if (ACTIVE_STATUSES.has(status) && scheduledDate >= today) {
    statusLabel = scheduledDate === today ? "Today" : "Upcoming";
  }

  if (category !== "completed" && category !== "cancelled") {
    category = pendingScheduleReview || residentResponseRequired || overdue || status === "missed"
      ? "actionRequired"
      : scheduledDate && scheduledDate >= today && ACTIVE_STATUSES.has(status)
        ? "upcoming"
        : "actionRequired";
  }

  return {
    statusLabel,
    statusDetail,
    category,
    pendingScheduleReview,
    awaitingResponse: residentResponseRequired,
    overdue,
    actionable: RESPONSE_STATUSES.has(status) && !overdue && !["reschedule requested", "cancellation requested", "cancellation approved"].includes(confirmation),
  };
}

// Handles summarizeResidentFollowUps logic.
export function summarizeResidentFollowUps(rows = [], now = new Date()) {
  return rows.reduce((counts, row) => {
    const category = getResidentFollowUpPresentation(row, now).category;
    counts[category] += 1;
    return counts;
  }, { actionRequired: 0, upcoming: 0, completed: 0, cancelled: 0 });
}
