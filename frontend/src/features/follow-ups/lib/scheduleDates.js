/**
 * Shared date/label helpers for the follow-up schedule calendars.
 *
 * Used by BOTH the Health Supervisor calendar and the Resident calendar so the
 * two views always group, label, and navigate dates identically. No external
 * date library — plain Date math only.
 */

export const pad = (n) => String(n).padStart(2, "0");

/** Local date → "YYYY-MM-DD" key. */
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "YYYY-MM-DD" key → local Date. */
export const fromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const sameDay = (a, b) => toKey(a) === toKey(b);

/** 6-week (Sun-start) grid covering the given date's month. */
export const monthGrid = (date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

/** The seven days (Sun–Sat) of the week containing the given date. */
export const weekDays = (date) => {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
};

/** "09:00" → "9:00 AM". */
export const formatTime = (time) => {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${ampm}`;
};

/** Full ISO timestamp → "Sep 13, 2026, 2:30 PM" (response timestamps). */
export const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

export const monthLabel = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

export const dayLabel = (d) =>
  d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export const weekLabel = (d) => {
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
};

/** Group schedules into a { "YYYY-MM-DD": [schedule…] } map, sorted by time. */
export const groupByDay = (schedules) => {
  const map = {};
  (schedules || []).forEach((s) => {
    (map[s.date] = map[s.date] || []).push(s);
  });
  Object.values(map).forEach((list) => list.sort((a, b) => (a.time || "").localeCompare(b.time || "")));
  return map;
};
