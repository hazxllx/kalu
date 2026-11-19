import { isPastSameDaySchedule, manilaDateKey } from "./scheduleDates.js";

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Rejected"]);
const MISSED_SOURCE_STATUSES = new Set(["Scheduled", "Today", "Upcoming", "Ongoing"]);

export const followUpActionAvailability = (
  followUp,
  { canEdit = false, canComplete = false, canRecordVisit = false } = {},
  now = new Date(),
) => {
  const status = String(followUp?.status || "Scheduled");
  const scheduledDate = String(followUp?.scheduledDateRaw || followUp?.scheduled_date || "").slice(0, 10);
  const scheduledTime = String(followUp?.scheduledTimeRaw || followUp?.scheduled_time || followUp?.scheduledTime || followUp?.time || "").slice(0, 5);
  const isClosed = TERMINAL_STATUSES.has(status);
  const today = manilaDateKey(now);
  const isDue = !scheduledDate || scheduledDate < today ||
    (scheduledDate === today && (!scheduledTime || isPastSameDaySchedule(scheduledDate, scheduledTime, now)));
  const responseStatus = String(followUp?.schedule_response_status || followUp?.scheduleResponseStatus || "");
  const pendingResidentRequest = ["Reschedule Requested", "Cancellation Requested"].includes(responseStatus);
  const legacyRejected = (followUp?.resident_decision || followUp?.residentDecision) === "rejected";
  const residentApproved = !pendingResidentRequest && !legacyRejected;

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
