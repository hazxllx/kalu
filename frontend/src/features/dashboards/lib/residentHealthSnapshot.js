import { manilaDateKey } from "../../follow-ups/lib/scheduleDates.js";
import { getResidentFollowUpPresentation } from "../../follow-ups/lib/residentFollowUpPresentation.js";

const dateKey = (value) => {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
};

export const numericVital = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function latestConsultation(consultations = []) {
  return [...consultations].sort((a, b) =>
    dateKey(b?.date).localeCompare(dateKey(a?.date)),
  )[0] || null;
}

export function latestRecordedVitals(consultations = []) {
  const ordered = [...consultations].sort((a, b) =>
    dateKey(b?.date).localeCompare(dateKey(a?.date)),
  );
  const latest = (key, parse = (value) => value) => {
    const record = ordered.find((item) => {
      const value = item?.vitals?.[key];
      return value !== null && value !== undefined && String(value).trim() !== "" && parse(value) !== null;
    });
    if (!record) return { value: null, date: "" };
    return { value: parse(record.vitals[key]), date: dateKey(record.date) };
  };
  return {
    bloodPressure: latest("bloodPressure", (value) => String(value).trim()),
    pulseRate: latest("pulseRate", numericVital),
    bmi: latest("bmi", numericVital),
  };
}

export function pulseReadings(consultations = []) {
  return consultations
    .map((item, index) => ({
      date: dateKey(item?.date),
      value: numericVital(item?.vitals?.pulseRate),
      index,
    }))
    .filter((item) => item.date && item.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
    .map(({ date, value }) => ({ date, value }));
}

export function visitTrend(consultations = [], followUps = [], now = new Date()) {
  const today = manilaDateKey(now);
  const weeks = ["3w ago", "2w ago", "Last week", "This week", "Next week", "2w ahead", "3w ahead"].map((key) => ({
    key,
    consultations: 0,
    completedFollowUps: 0,
    upcoming: 0,
    overdue: 0,
  }));
  const todayDate = new Date(`${today}T00:00:00Z`);
  const currentWeekStart = new Date(todayDate);
  currentWeekStart.setUTCDate(todayDate.getUTCDate() - todayDate.getUTCDay());
  const weekIndexFor = (value) => {
    const date = dateKey(value);
    if (!date) return -1;
    const activityDate = new Date(`${date}T00:00:00Z`);
    const difference = Math.floor((activityDate.getTime() - currentWeekStart.getTime()) / (7 * 86400000));
    const index = difference + 3;
    return index >= 0 && index < weeks.length ? index : -1;
  };

  consultations.forEach((row) => {
    const index = weekIndexFor(row?.date);
    if (index >= 0) weeks[index].consultations += 1;
  });
  followUps.forEach((row) => {
    const date = dateKey(row?.scheduledDate);
    const index = weekIndexFor(date);
    if (index < 0) return;
    const presentation = getResidentFollowUpPresentation(row, now);
    if (presentation.category === "completed") {
      weeks[index].completedFollowUps += 1;
    } else if (presentation.overdue || presentation.statusLabel === "Missed") {
      weeks[index].overdue += 1;
    } else if (presentation.category === "upcoming" || presentation.awaitingResponse) {
      weeks[index].upcoming += 1;
    }
  });
  return weeks;
}
