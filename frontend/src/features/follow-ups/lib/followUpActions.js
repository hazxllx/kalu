import { manilaDateKey } from "./scheduleDates.js";

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Rejected"]);
const MISSED_SOURCE_STATUSES = new Set(["Scheduled", "Today", "Upcoming", "Ongoing"]);

export const followUpActionAvailability = (
  followUp,
  { canEdit = false, canComplete = false, canRecordVisit = false } = {},
  now = new Date(),
) => {
  const status = String(followUp?.status || "Scheduled");
  const scheduledDate = String(followUp?.scheduledDateRaw || followUp?.scheduled_date || "").slice(0, 10);
  const isClosed = TERMINAL_STATUSES.has(status);
  const isDue = !scheduledDate || scheduledDate <= manilaDateKey(now);
  const residentApproved =
    !followUp?.requires_resident_response && !followUp?.requiresResidentResponse ||
    (followUp?.resident_decision || followUp?.residentDecision) === "approved";

  return {
    view: true,
    edit: canEdit && !isClosed,
    updateStatus: canEdit && !isClosed,
    addRemarks: canEdit && !isClosed,
    complete: canComplete &&
      !isClosed &&
      status !== "Pending" &&
      status !== "Missed" &&
      isDue &&
      residentApproved,
    missed: canComplete &&
      MISSED_SOURCE_STATUSES.has(status) &&
      isDue &&
      residentApproved,
    cancel: canEdit && !isClosed,
    recordVisit: canRecordVisit &&
      !isClosed &&
      status !== "Pending" &&
      status !== "Missed" &&
      isDue &&
      residentApproved,
  };
};
