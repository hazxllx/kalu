/**
 * Isolated UI preview dataset for the Health Supervisor Schedule Calendar.
 *
 * DEVELOPMENT / DEMONSTRATION ONLY. These rows show how the calendar presents a
 * busy date (November 16, 2026) with many scheduled follow-ups. They are NOT
 * production records: they never touch the Supabase database, never create
 * resident accounts or health records, and are never mixed into backend results.
 *
 * To disable the demo, flip SHOW_PREVIEW_DEMO to false (or remove it). Preview
 * events are tagged with `preview: true` and carry `id: "preview:<n>"` so they
 * can never collide with real appointment IDs and are excluded from any saving.
 */
export const SHOW_PREVIEW_DEMO = true;

const PREVIEW_DATE = "2026-11-16";

/**
 * Sample Filipino follow-up appointments, one per planned calendar slot.
 * Ordered by time; the calendar sorts them chronologically regardless.
 */
const PREVIEW_SCHEDULES = [
  ["Maria Santos", "Fever follow-up", "08:00", "Ana Cruz"],
  ["Juan Dela Cruz", "Blood pressure monitoring", "08:30", "Mark Reyes"],
  ["Ana Reyes", "Prenatal follow-up", "09:00", "Ana Cruz"],
  ["Jose Garcia", "Diabetes monitoring", "09:30", "Mark Reyes"],
  ["Angela Mendoza", "Post-consultation follow-up", "10:00", "Ana Cruz"],
  ["Carlo Bautista", "Tuberculosis follow-up", "10:30", "Mark Reyes"],
  ["Sofia Ramos", "Child health follow-up", "13:00", "Ana Cruz"],
  ["Miguel Torres", "Medication follow-up", "13:30", "Mark Reyes"],
  ["Patricia Flores", "General health follow-up", "14:00", "Ana Cruz"],
  ["Daniel Navarro", "Blood pressure recheck", "14:30", "Mark Reyes"],
];

/** Build the preview events in the same shape the calendar views expect. */
export function buildPreviewScheduleEvents() {
  if (!SHOW_PREVIEW_DEMO) return [];
  return PREVIEW_SCHEDULES.map(([residentName, purpose, time, provider], index) => ({
    id: `preview:${index + 1}`,
    type: "follow-up",
    typeLabel: "Follow-up",
    dateKey: PREVIEW_DATE,
    date: PREVIEW_DATE,
    time,
    label: purpose,
    residentName,
    residentBarangay: "",
    status: "Scheduled",
    category: "",
    location: "",
    provider,
    purpose,
    priority: "",
    instructions: "",
    detail: purpose,
    preview: true,
  }));
}