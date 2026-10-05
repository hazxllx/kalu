export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

export function buildDayMap(events = []) {
  const map = {};

  events.forEach((event) => {
    const dateKey = event?.dateKey || event?.date || event?.scheduledDate;
    if (!dateKey) return;
    const clean = String(dateKey).slice(0, 10);
    if (!clean) return;
    if (!map[clean]) map[clean] = [];
    map[clean].push(event);
  });

  Object.values(map).forEach((list) => {
    list.sort((a, b) => {
      const aTime = String(a.time || a.scheduledTime || "").slice(0, 5) || "23:59";
      const bTime = String(b.time || b.scheduledTime || "").slice(0, 5) || "23:59";
      return aTime.localeCompare(bTime);
    });
  });

  return map;
}

export function mapFollowUpEvent(row) {
  if (!row) return null;
  const resident = row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : "Resident";

  return {
    id: row.id,
    type: "follow-up",
    typeLabel: "Follow-up",
    dateKey: String(row.scheduled_date || row.date || "").slice(0, 10),
    date: String(row.scheduled_date || row.date || "").slice(0, 10),
    time: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    label: row.purpose || "Follow-up",
    residentName: resident,
    residentBarangay: row.resident?.barangay || row.barangay || "",
    status: row.status || "Scheduled",
    location: row.location || "",
    provider: row.assigned_provider || "",
    detail: row.notes || row.purpose || "",
  };
}

export function mapHealthServiceEvent(row) {
  if (!row) return null;
  const residentName = row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : "Resident";

  return {
    id: row.id,
    type: "health-service",
    typeLabel: "Health Service",
    dateKey: String(row.scheduled_date || row.date || "").slice(0, 10),
    date: String(row.scheduled_date || row.date || "").slice(0, 10),
    time: "",
    label: row.service?.name || "Health service",
    residentName,
    residentBarangay: row.residentBarangay || row.resident?.barangay || "",
    status: row.attendanceStatus || row.attendance_status || "scheduled",
    location: row.location || row.service?.facility || "",
    provider: row.service?.category || "",
    detail: row.notes || row.service?.category || "",
  };
}
