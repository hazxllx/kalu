/**
 * Shared vocabulary + formatting for the appointment feature.
 *
 * The backend stores lifecycle statuses in snake_case (pending, approved,
 * reschedule_proposed, ...). The UI renders the matching capitalized labels,
 * which also key into the shared <StatusBadge/> tone map.
 */
export const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  reschedule_proposed: "Reschedule Proposed",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  missed: "Missed",
};

export const statusLabel = (status) => STATUS_LABEL[status] || status || "";

/** Statuses still "open" from the resident's point of view. */
export const OPEN_STATUSES = ["pending", "reschedule_proposed", "approved"];

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Format an ISO "yyyy-MM-dd" as "Sep 27, 2026" using the local calendar day. */
export const formatDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/** Format a 24h "HH:MM" string as "9:00 AM". */
export const formatTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
};

/** The schedule a resident should act on: confirmed if present, else requested. */
export const effectiveSchedule = (appt) => {
  if (!appt) return { date: "", time: "" };
  if (appt.confirmedDate) return { date: appt.confirmedDate, time: appt.confirmedTime };
  if (appt.status === "reschedule_proposed" && appt.proposedDate) {
    return { date: appt.proposedDate, time: appt.proposedTime };
  }
  return { date: appt.requestedDate, time: appt.requestedTime };
};

export const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Day-of-week (0=Sunday..6=Saturday) for an ISO "yyyy-MM-dd" date, UTC-safe. */
export const weekdayOf = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Generate "HH:MM" slot start times from start..end stepped by slotMinutes. */
export const slotTimes = (startTime, endTime, slotMinutes) => {
  const toMin = (t) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const out = [];
  const end = toMin(endTime);
  const step = Number(slotMinutes) || 30;
  for (let cur = toMin(startTime); cur + step <= end; cur += step) {
    out.push(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
  }
  return out;
};
