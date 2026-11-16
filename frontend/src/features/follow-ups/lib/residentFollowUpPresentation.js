import { manilaDateKey } from "./scheduleDates.js";

const ACTIVE_STATUSES = new Set(["pending", "scheduled", "today", "upcoming", "ongoing"]);
const RESPONSE_STATUSES = new Set(["pending", "scheduled"]);

const normalized = (value) => String(value || "").trim().toLowerCase();
const dateKey = (value) => {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
};

export function getResidentFollowUpPresentation(row = {}, now = new Date()) {
  const status = normalized(row.status);
  const confirmation = normalized(row.confirmationStatus);
  const scheduledDate = dateKey(row.scheduledDate);
  const today = manilaDateKey(now);
  const active = ACTIVE_STATUSES.has(status);
  const awaitingResponse = Boolean(active && (
    confirmation === "awaiting confirmation" ||
    (status === "pending" && confirmation !== "confirmed" && confirmation !== "rejected") ||
    (row.requiresResidentResponse && !confirmation)
  ));
  const confirmed = active && confirmation === "confirmed";
  const overdue = active && Boolean(scheduledDate) && scheduledDate < today;

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
  } else if (overdue) {
    statusLabel = "Overdue";
    statusDetail = awaitingResponse
      ? "Awaiting your response"
      : confirmed
        ? "Confirmed · attendance not recorded"
        : "Appointment date passed";
  } else if (awaitingResponse) {
    statusLabel = "Awaiting Response";
  } else if (confirmed) {
    statusLabel = "Confirmed";
  } else if (ACTIVE_STATUSES.has(status) && scheduledDate >= today) {
    statusLabel = scheduledDate === today ? "Today" : "Upcoming";
  }

  if (category !== "completed" && category !== "cancelled") {
    category = awaitingResponse || overdue || status === "missed"
      ? "actionRequired"
      : scheduledDate && scheduledDate >= today && ACTIVE_STATUSES.has(status)
        ? "upcoming"
        : "actionRequired";
  }

  return {
    statusLabel,
    statusDetail,
    category,
    awaitingResponse,
    overdue,
    actionable: RESPONSE_STATUSES.has(status) && awaitingResponse,
  };
}

export function summarizeResidentFollowUps(rows = [], now = new Date()) {
  return rows.reduce((counts, row) => {
    const category = getResidentFollowUpPresentation(row, now).category;
    counts[category] += 1;
    return counts;
  }, { actionRequired: 0, upcoming: 0, completed: 0, cancelled: 0 });
}
