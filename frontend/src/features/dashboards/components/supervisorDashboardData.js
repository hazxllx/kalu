export const OPEN_REFERRAL_STATUSES = new Set(["Pending", "Accepted", "In Progress"]);
export const OPEN_CONSULTATION_STATUSES = ["draft", "submitted", "received", "in_review", "referred"];
const OPEN_FOLLOW_UPS = new Set(["scheduled", "pending", "today", "upcoming", "ongoing"]);
const CONSULTATION_LABELS = { draft: "Draft", submitted: "Submitted", received: "Received", in_review: "In Review", referred: "Referred" };
const BASE = "/app/health_supervisor";

export function requireDashboardRows(response, source) {
  const rows = Array.isArray(response) ? response : response?.rows;
  if (!Array.isArray(rows) || rows.some((row) => !row || !row.id)) {
    throw new Error(`The ${source} service returned an incomplete record list.`);
  }
  return rows;
}

export function residentDisplayName(resident) {
  if (typeof resident === "string") return resident.trim() || "Resident name unavailable";
  return resident?.name || [
    resident?.firstName ?? resident?.first_name,
    resident?.middleName ?? resident?.middle_name,
    resident?.lastName ?? resident?.last_name,
  ].filter(Boolean).join(" ") || "Resident name unavailable";
}

export function recordsForBarangay(rows, barangay) {
  if (!barangay || !Array.isArray(rows)) return [];
  const assigned = String(barangay).trim().toLowerCase();
  return rows.filter((row) => String(row.resident?.barangay || row.residentBarangay || row.barangay || "").trim().toLowerCase() === assigned);
}

export function isOpenFollowUp(row) {
  return OPEN_FOLLOW_UPS.has(String(row?.status || "").toLowerCase()) && row?.resident_decision !== "rejected";
}

export function isOverdueFollowUp(row, today) {
  if (!isOpenFollowUp(row)) return false;
  if (typeof row.is_overdue === "boolean") return row.is_overdue;
  const due = String(row.scheduled_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today;
}

/** Keep separate records separate, including namesakes and multiple care needs. */
export function buildMonitoringPriorities({ residents = [], referrals = [], followUps = [], consultations = [], barangay, today }) {
  const records = new Map();
  const add = (item) => records.set(item.key, item);
  recordsForBarangay(residents, barangay).filter((row) => row.riskLevel === "High").forEach((row) => add({
    key: `resident-${row.id}`, residentId: row.id, resident: residentDisplayName(row),
    category: "Resident assessment", priority: "High Risk", tone: "danger", rank: 0,
    detail: "High risk in the latest recorded assessment", status: row.riskLevel,
    date: row.riskAssessedAt || "", dateLabel: "Assessed", filters: ["high-risk"],
    href: `${BASE}/residents?residentId=${encodeURIComponent(row.id)}`, action: "View Resident",
  }));

  recordsForBarangay(followUps, barangay).filter(isOpenFollowUp).forEach((row) => {
    const due = String(row.scheduled_date || "").slice(0, 10);
    const overdue = isOverdueFollowUp(row, today);
    const dueToday = typeof row.is_due_today === "boolean" ? row.is_due_today : due === today;
    const confirmationPending = row.requires_resident_response && row.resident_decision === "pending";
    if (!overdue && !dueToday && !confirmationPending) return;
    add({
      key: `followup-${row.id}`, residentId: row.resident_id, resident: residentDisplayName(row.resident),
      category: "Follow-up", priority: overdue ? "Overdue" : dueToday ? "Due Today" : "Awaiting Response",
      tone: overdue ? "danger" : "warning", rank: overdue ? 1 : 4,
      detail: row.purpose || "Purpose not recorded", status: overdue ? "Overdue" : dueToday ? "Today" : row.status,
      date: due, dateLabel: "Due", filters: overdue ? ["overdue"] : [],
      href: `${BASE}/followups?followup=${encodeURIComponent(row.id)}`, action: "View Follow-up",
    });
  });

  recordsForBarangay(referrals, barangay).filter((row) => OPEN_REFERRAL_STATUSES.has(row.status)).forEach((row) => add({
    key: `referral-${row.id}`, residentId: row.resident_id, resident: residentDisplayName(row.resident),
    category: "Referral", priority: row.priority === "High" ? "High Priority" : row.status === "Pending" ? "Pending Referral" : "Unresolved",
    tone: row.priority === "High" ? "warning" : "info", rank: row.priority === "High" ? 2 : 3,
    detail: [row.reason, row.destination_facility].filter(Boolean).join(" | ") || "Reason not recorded",
    status: row.status, date: row.referral_date || row.created_at || "", dateLabel: "Referred",
    filters: row.status === "Pending" ? ["pending-referral"] : [],
    href: `${BASE}/referrals?referral=${encodeURIComponent(row.id)}`, action: "View Referral",
  }));

  recordsForBarangay(consultations, barangay).filter((row) => OPEN_CONSULTATION_STATUSES.includes(row.status)).forEach((row) => add({
    key: `consultation-${row.id}`, residentId: row.resident?.id, resident: residentDisplayName(row.resident),
    category: "Consultation", priority: "Unresolved", tone: "info", rank: 5,
    detail: row.chiefComplaint || "Complaint not recorded", status: CONSULTATION_LABELS[row.status],
    date: row.consultationDate || row.createdAt || "", dateLabel: "Recorded", filters: [],
    href: `${BASE}/consultations?consultation=${encodeURIComponent(row.id)}`, action: "View Consultation",
  }));

  return [...records.values()].sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function matchesMonitoringFilter(item, filter) {
  return filter === "all" || item.filters.includes(filter);
}

export function upcomingActivities(events, from, to, limit = 5) {
  return events.filter((event) => event?.id && event.dateKey >= from && event.dateKey <= to &&
    (event.type === "follow-up" ? isOpenFollowUp(event) : String(event.status || "").toLowerCase() === "scheduled"))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.time || "24:00").localeCompare(b.time || "24:00") || `${a.type}-${a.id}`.localeCompare(`${b.type}-${b.id}`))
    .slice(0, limit);
}

export function requireSupervisorMap(data, barangay) {
  if (!barangay || data?.scope !== "barangay" || data.scopeComplete !== true || !Array.isArray(data.barangays) ||
      data.barangays.some((row) => row.name !== barangay || !Array.isArray(row.conditions) ||
        ![row.caseCount, row.activeCases, row.completedCases].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        row.conditions.some((condition) => typeof condition.name !== "string" || !Number.isSafeInteger(condition.value) || condition.value < 0)) ||
      !Number.isSafeInteger(data.summary?.activeCases) || data.summary.activeCases < 0) {
    throw new Error("Community health data is incomplete or outside your assigned barangay.");
  }
  return data;
}

export function riskDistributionRows(rows) {
  if (!Array.isArray(rows)) return null;
  const labels = ["Low Risk", "Moderate Risk", "High Risk", "Unassessed"];
  const result = labels.map((name) => rows.find((row) => row.name === name));
  return result.every((row) => row && Number.isSafeInteger(row.value) && row.value >= 0) ? result : null;
}

export function dashboardGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Four completed months before the selected reporting month, never a rolling slice. */
export function previousFourMonths(year, month) {
  return Array.from({ length: 4 }, (_, index) => {
    const date = new Date(year, month - 4 + index, 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-PH", { month: "short" }),
      year: date.getFullYear(),
      month: date.getMonth(),
    };
  });
}

export function enrichMonitoringCases(items, { residents = [], referrals = [], followUps = [], consultations = [] }) {
  const people = new Map(residents.map((row) => [row.id, row]));
  const sources = new Map();
  residents.forEach((row) => sources.set(`resident-${row.id}`, row));
  referrals.forEach((row) => sources.set(`referral-${row.id}`, row));
  followUps.forEach((row) => sources.set(`followup-${row.id}`, row));
  consultations.forEach((row) => sources.set(`consultation-${row.id}`, row));
  return items.map((item) => {
    const record = sources.get(item.key) || {};
    const person = people.get(item.residentId || record.resident_id || record.resident?.id) || record.resident || {};
    const risk = ["High", "Moderate", "Low"].includes(person.riskLevel) ? person.riskLevel : null;
    const purok = person.purok || person.household?.purok || record.purok || "";
    const zone = person.zone ?? record.resident?.zone;
    const area = purok ? (/^purok\b/i.test(String(purok)) ? String(purok) : `Purok ${purok}`)
      : Number.isInteger(zone) && zone >= 1 && zone <= 8 ? `Zone ${zone}` : "Purok not recorded";
    const responsible = record.assigned_provider || record.responsiblePersonnelName || record.phn?.personnel ||
      record.recipient?.full_name || person.assignedBhw?.name || "";
    const factors = item.category === "Resident assessment" && Array.isArray(person.riskFactors)
      ? person.riskFactors.map((factor) => typeof factor === "string" ? factor : factor?.label || factor?.message || factor?.reason || "").filter(Boolean).join("; ") : "";
    return {
      ...item,
      riskLevel: risk,
      riskLabel: risk === "Moderate" ? "Medium Risk" : risk ? `${risk} Risk` : "Risk unassessed",
      area,
      areaBasis: purok ? "Recorded purok" : Number.isInteger(zone) ? "Recorded zone; no verified purok crosswalk" : "Area unavailable",
      responsible: typeof responsible === "string" ? responsible : responsible?.name || "",
      detail: factors || item.detail,
      filters: [...new Set([...item.filters, ...(risk === "High" ? ["high-risk"] : [])])],
    };
  });
}

export function openedCaseSeries(rows, months) {
  if (!Array.isArray(rows)) throw new Error("Consultation creation records are unavailable.");
  const counts = new Map(months.map((month) => [month.key, 0]));
  const seen = new Set();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" });
  for (const row of rows) {
    if (!row?.id) throw new Error("A consultation record identifier is unavailable.");
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const recorded = row.createdAt || row.created_at;
    const date = recorded ? new Date(recorded) : null;
    if (!date || Number.isNaN(date.getTime())) throw new Error("A consultation creation timestamp is unavailable; opened-case totals cannot be verified.");
    const parts = formatter.formatToParts(date);
    const key = `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return months.map((month) => ({ ...month, opened: counts.get(month.key) }));
}

export function highRiskCaseSeries(responses, months, barangay) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const values = new Map();
  for (const response of responses) {
    if (response?.scope !== "barangay" || response.barangay !== barangay || response.riskLevel !== "High" || response.scopeComplete !== true ||
        !Number.isInteger(response.year) || !Array.isArray(response.monthly) || response.monthly.length !== 12) {
      throw new Error("Historical high-risk case data is incomplete or outside your assigned barangay.");
    }
    for (const row of response.monthly) {
      const index = labels.indexOf(row.month);
      if (index < 0 || !Number.isSafeInteger(row.cases) || row.cases < 0) throw new Error("Historical high-risk case counts are unavailable.");
      const key = `${response.year}-${String(index + 1).padStart(2, "0")}`;
      if (values.has(key)) throw new Error("Historical high-risk months were repeated.");
      values.set(key, row.cases);
    }
  }
  return months.map((month) => {
    if (!values.has(month.key)) throw new Error("A requested high-risk reporting month is unavailable.");
    return { ...month, highRisk: values.get(month.key) };
  });
}

export function followUpPerformance(rows, range, today) {
  if (!Array.isArray(rows)) return null;
  const cohort = rows.filter((row) => row.scheduled_date >= range.from && String(row.scheduled_date).slice(0, 10) <= range.to);
  const completed = cohort.filter((row) => row.status === "Completed").length;
  const overdue = cohort.filter((row) => isOverdueFollowUp(row, today)).length;
  const pending = cohort.filter((row) => isOpenFollowUp(row) && !isOverdueFollowUp(row, today)).length;
  return {
    scheduled: cohort.length,
    completed,
    pending,
    overdue,
    other: cohort.length - completed - pending - overdue,
    percentage: cohort.length ? Math.round(completed / cohort.length * 100) : null,
  };
}

/** Quote every field and neutralize spreadsheet formulas before reusing the CSV downloader. */
export function monitoringCasesCsv(rows) {
  const cell = (value) => {
    let text = value == null ? "" : String(value);
    if (/^[=+@\-\t\r]/.test(text.trimStart()) || /^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ["Resident", "Clinical Risk", "Concern / Reason", "Recorded Area", "Relevant Date", "Date Basis", "Responsible Personnel", "Record Type", "Record ID"];
  return [header, ...rows.map((row) => [row.resident, row.riskLabel || "Unassessed", row.detail, row.area,
    row.date, row.dateLabel, row.responsible, row.category, row.key])].map((row) => row.map(cell).join(",")).join("\r\n");
}
