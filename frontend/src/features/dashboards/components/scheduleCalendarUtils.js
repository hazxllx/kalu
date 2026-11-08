export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return toDateKey(date) === value ? date : null;
}

export function monthRange(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    from: toDateKey(first),
    to: toDateKey(last),
  };
}

export function buildMonthGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const grid = [];
  const cursor = new Date(start);

  for (let week = 0; week < 6; week += 1) {
    const cells = [];
    for (let day = 0; day < 7; day += 1) {
      cells.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(cells);
  }

  return grid;
}

/** Fetch every displayed date, including the adjacent-month cells. */
export function calendarVisibleRange(date, view = "month") {
  if (view === "month") {
    const days = buildMonthGrid(date).flat();
    return { from: toDateKey(days[0]), to: toDateKey(days[days.length - 1]) };
  }
  if (view === "agenda") return monthRange(date);
  if (view === "week") {
    const first = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    const last = new Date(first);
    last.setDate(first.getDate() + 6);
    return { from: toDateKey(first), to: toDateKey(last) };
  }
  const key = toDateKey(date);
  return { from: key, to: key };
}

export function stepCalendarDate(date, view, direction) {
  const next = new Date(date);
  if (view === "month" || view === "agenda") {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + direction);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  } else {
    next.setDate(next.getDate() + (view === "week" ? 7 : 1) * direction);
  }
  return next;
}

export const calendarEventKey = (event) => `${event.type}-${event.id}`;

export function formatCalendarStatus(status) {
  const value = String(status || "").trim();
  return value ? value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Not recorded";
}

/** Geography is the resident's actual barangay, never the service's visibility. */
export function isCalendarEventInBarangay(event, assignedBarangay) {
  const assigned = String(assignedBarangay || "").trim().toLowerCase();
  const residentBarangay = String(event?.residentBarangay || "").trim().toLowerCase();
  return Boolean(assigned && residentBarangay && assigned === residentBarangay);
}

export function readCalendarRows(response, source = "Schedule") {
  const rows = Array.isArray(response) ? response : response?.rows;
  if (!Array.isArray(rows)) throw new Error(`${source} returned an invalid record list.`);
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        !["string", "number"].includes(typeof row.id) || String(row.id).trim() === "" ||
        (typeof row.id === "number" && !Number.isFinite(row.id))) {
      throw new Error(`${source} returned a record without a valid ID.`);
    }
    const date = row.scheduled_date ?? row.date;
    if (date !== undefined && date !== null && date !== "" && !parseCalendarDate(date)) {
      throw new Error(`${source} returned an invalid schedule date.`);
    }
  }
  return rows;
}

export function buildDayMap(events = []) {
  const map = {};

  events.forEach((event) => {
    const dateKey = event?.dateKey || event?.date || event?.scheduledDate;
    if (!dateKey) return;
    const clean = String(dateKey).slice(0, 10);
    if (!parseCalendarDate(clean)) return;
    if (!map[clean]) map[clean] = [];
    map[clean].push(event);
  });

  Object.values(map).forEach((list) => {
    list.sort((a, b) => {
      const aTime = String(a.time || a.scheduledTime || "").slice(0, 5) || "24:00";
      const bTime = String(b.time || b.scheduledTime || "").slice(0, 5) || "24:00";
      return aTime.localeCompare(bTime) ||
        String(a.type || "").localeCompare(String(b.type || "")) ||
        String(a.category || "").localeCompare(String(b.category || "")) ||
        String(a.id).localeCompare(String(b.id));
    });
  });

  return map;
}

export function mapFollowUpEvent(row) {
  if (!row) return null;
  const resident = row.resident && typeof row.resident === "object"
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : row.residentName;
  const decision = row.resident_decision ?? row.residentDecision ?? "";
  const requiresResponse = row.requires_resident_response ?? row.requiresResidentResponse ?? false;
  const confirmation = decision === "approved" ? "Confirmed"
    : decision === "rejected" ? "Rejected"
    : requiresResponse || decision === "pending" ? "Awaiting Confirmation"
    : row.confirmationStatus || null;
  const instructions = row.notes ?? row.instructions ?? "";
  const date = String(row.scheduled_date ?? row.date ?? "").slice(0, 10);

  return {
    id: row.id,
    type: "follow-up",
    typeLabel: "Follow-up",
    dateKey: date,
    date,
    time: String(row.scheduled_time ?? row.time ?? "").slice(0, 5),
    label: row.purpose || "Follow-up",
    residentId: row.resident_id ?? row.residentId ?? "",
    residentName: resident || "Resident",
    residentBarangay: row.resident?.barangay ?? row.residentBarangay ?? row.barangay ?? "",
    status: row.status || "",
    category: "",
    location: row.location || "",
    provider: row.assigned_provider ?? row.provider ?? "",
    purpose: row.purpose || "",
    priority: row.priority || "",
    instructions,
    detail: instructions || row.purpose || "",
    requiresResidentResponse: Boolean(requiresResponse),
    residentDecision: decision,
    confirmationStatus: confirmation,
    respondedAt: row.resident_decision_at ?? row.respondedAt ?? "",
    rejectionReason: decision === "rejected" ? row.resident_decision_reason ?? row.rejectionReason ?? "" : "",
    completedAt: row.completed_at ?? row.completedAt ?? "",
    isDueToday: row.is_due_today === true,
    isOverdue: row.is_overdue === true,
    offline: Boolean(row.offline),
    syncStatus: row.syncStatus || "",
  };
}

export function mapHealthServiceEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: "health-service",
    typeLabel: "Health Service",
    dateKey: String(row.scheduled_date || row.date || "").slice(0, 10),
    date: String(row.scheduled_date || row.date || "").slice(0, 10),
    time: "",
    label: row.service?.name || "Health service",
    residentId: row.resident_id ?? "",
    residentName: typeof row.resident === "string" && row.resident.trim() ? row.resident : "Resident",
    residentBarangay: row.residentBarangay || "",
    serviceId: row.service_id ?? row.service?.id ?? "",
    category: row.service?.category || "",
    status: row.attendanceStatus ?? row.attendance_status ?? "",
    location: "",
    provider: "",
    detail: row.notes || "",
    attendedAt: row.attended_at || "",
    recordedBy: row.recorded_by_name || "",
  };
}
