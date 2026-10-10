/**
 * Formatting helpers for the resident Health Services directory and the
 * "I plan to visit" modal. Dates are parsed as UTC calendar dates (matching the
 * backend) so a "yyyy-MM-dd" never shifts a day across timezones.
 */

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse "yyyy-MM-dd" into a UTC Date, or null. */
export function parseISO(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** [1,3,5] -> "Mon, Wed, Fri" */
export function formatWeekdays(weekdays = []) {
  return weekdays
    .slice()
    .sort((a, b) => a - b)
    .map((w) => WEEKDAYS_SHORT[w])
    .filter(Boolean)
    .join(", ");
}

/** "08:00" -> "8:00 AM" */
export function formatTime(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "08:00","11:00" -> "8:00–11:00 AM"; "08:00","13:00" -> "8:00 AM – 1:00 PM" */
export function formatWindow(start, end) {
  if (!start || !end) return "";
  const full = (hhmm) => formatTime(hhmm);
  const bare = (hhmm) => formatTime(hhmm).replace(/\s?[AP]M$/, "");
  const mer = (hhmm) => (Number(hhmm.split(":")[0]) >= 12 ? "PM" : "AM");
  if (mer(start) === mer(end)) return `${bare(start)}–${bare(end)} ${mer(end)}`;
  return `${full(start)} – ${full(end)}`;
}

/** "2026-10-15" -> "Wed, 15 Oct" */
export function formatPlanDate(iso) {
  const date = parseISO(iso);
  if (!date) return "";
  return `${WEEKDAYS_SHORT[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
}

/** Day-picker chip: { top: "Wed", bottom: "15 Oct" } */
export function formatChip(iso) {
  const date = parseISO(iso);
  if (!date) return { top: "", bottom: "" };
  return {
    top: WEEKDAYS_SHORT[date.getUTCDay()],
    bottom: `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`,
  };
}

/**
 * The one-line availability summary for a service card.
 * Returns "" when the service has an open day in the next two weeks, else the
 * fallback copy. Callers decide the muted styling for the fallback.
 */
export function availabilityLine({ weekdays = [], windowStart, windowEnd, hasUpcoming }) {
  if (!hasUpcoming || weekdays.length === 0) return { text: "No open slots in the next two weeks.", open: false };
  const days = formatWeekdays(weekdays);
  const window = formatWindow(windowStart, windowEnd);
  return { text: `Available ${days}${window ? ` · ${window}` : ""}`, open: true };
}
