/**
 * Public Health Nurse (RHU-level) mock datasets — frontend only.
 *
 * SCOPE MODEL
 * Each row carries an optional `barangay`:
 *   - an official barangay  → barangay-scoped data (San Isidro / San Antonio /
 *                             Old San Roque)
 *   - `null` / missing      → RHU-level data (no barangay assignment)
 *
 * Consumers apply `filterRowsByScope(rows, user)` from `@/lib/phnScope` before
 * rendering, so an unassigned PHN sees RHU-level rows only and an assigned
 * PHN sees RHU-level rows + their own barangay.
 */

import { BARANGAYS, BARANGAY_FILTERS } from "@/lib/barangays";

/** The ONLY barangays valid anywhere in the KALUSAGAP frontend. */
export { BARANGAYS, BARANGAY_FILTERS };

/** Canonical referral statuses for the PHN workflow. */
export const REFERRAL_STATUSES = Object.freeze([
  "For Review",
  "Accepted",
  "Pending",
  "Follow-up Required",
  "Completed",
]);

/** Canonical follow-up statuses. */
export const FOLLOWUP_STATUSES = Object.freeze([
  "Scheduled",
  "Due Today",
  "Overdue",
  "Completed",
  "Cancelled",
]);

/** Canonical health-service statuses. */
export const SERVICE_STATUSES = Object.freeze(["Scheduled", "Ongoing", "Completed", "Cancelled"]);

export const PHN_PROFILE = Object.freeze({
  name: "Ana Villanueva",
  role: "Public Health Nurse",
  facility: "Rural Health Unit",
});

/**
 * Per-barangay community baseline for a barangay-assigned PHN. These rows are
 * only rendered for the PHN's OWN assigned barangay — never for all three.
 * (The old dashboard displayed all three; that view is gone.)
 */
export const barangayCommunity = [
  {
    name: "San Isidro",
    residents: 542,
    activeCases: 18,
    referrals: 3,
    followUps: 6,
    healthServices: 7,
    priorityCases: 3,
    recentActivity: [
      { text: "New referral from BHS San Isidro requires review.", time: "2 hours ago" },
      { text: "Immunization session logged — 12 children vaccinated.", time: "Yesterday" },
      { text: "3 prenatal check-ups completed.", time: "2 days ago" },
    ],
  },
  {
    name: "San Antonio",
    residents: 418,
    activeCases: 11,
    referrals: 2,
    followUps: 4,
    healthServices: 6,
    priorityCases: 2,
    recentActivity: [
      { text: "Increase in respiratory cases reported this week.", time: "5 hours ago" },
      { text: "BP screening completed — 15 residents screened.", time: "Yesterday" },
      { text: "Health education session conducted.", time: "3 days ago" },
    ],
  },
  {
    name: "Old San Roque",
    residents: 288,
    activeCases: 7,
    referrals: 1,
    followUps: 3,
    healthServices: 5,
    priorityCases: 2,
    recentActivity: [
      { text: "Several follow-ups overdue for NCD patients.", time: "1 hour ago" },
      { text: "Nutrition monitoring visit completed.", time: "Yesterday" },
      { text: "TB treatment adherence check completed.", time: "4 days ago" },
    ],
  },
];

/**
 * Patients currently in the RHU check-up queue (awaiting PHN consultation).
 * A `barangay` of null means the patient is RHU-level / not assigned to a
 * specific barangay. Status mirrors the triage → PHN hand-off workflow.
 */
export const phnCheckupQueue = [
  { id: 1, patient: "Rosa Dimagiba", age: 34, sex: "Female", barangay: null, reason: "BP re-check", status: "Waiting for PHN", queuedAt: "8:40 AM", notes: "Walk-in at RHU, no barangay assignment." },
  { id: 2, patient: "Elena Garcia", age: 25, sex: "Female", barangay: "San Isidro", reason: "Prenatal assessment", status: "Waiting for PHN", queuedAt: "9:05 AM", notes: "Referred by BHS San Isidro." },
  { id: 3, patient: "Marites Ramos", age: 41, sex: "Female", barangay: "San Isidro", reason: "Cough for 2 weeks", status: "Waiting for PHN", queuedAt: "9:20 AM", notes: "TB symptom screening requested." },
  { id: 4, patient: "Dante Villar", age: 58, sex: "Male", barangay: "San Antonio", reason: "Uncontrolled hypertension", status: "Waiting for PHN", queuedAt: "9:35 AM", notes: "Referred by BHS San Antonio." },
  { id: 5, patient: "Sofia Reyes", age: 7, sex: "Female", barangay: "Old San Roque", reason: "Nutrition follow-up", status: "Waiting for PHN", queuedAt: "10:00 AM", notes: "Referred by BHS Old San Roque." },
  { id: 6, patient: "Andres Banaag", age: 60, sex: "Male", barangay: null, reason: "Diabetes medication review", status: "Waiting for PHN", queuedAt: "10:15 AM", notes: "RHU-level follow-up patient." },
  { id: 7, patient: "Kris Marquez", age: 22, sex: "Female", barangay: "San Isidro", reason: "Immunization follow-up", status: "Waiting for PHN", queuedAt: "10:30 AM", notes: "Referred by BHW Grace Aquino." },
];

/** Residents monitored across the RHU (barangay = null means RHU-level). */
export const phnResidents = [
  { id: "R-2001", name: "Maria Santos", age: 28, gender: "Female", barangay: "San Isidro", risk: "Low", status: "Active", program: "Maternal Care" },
  { id: "R-2002", name: "Juan Dela Cruz", age: 54, gender: "Male", barangay: "San Isidro", risk: "High", status: "Active", program: "Hypertension" },
  { id: "R-2003", name: "Rosa Bautista", age: 67, gender: "Female", barangay: "San Isidro", risk: "Medium", status: "Active", program: "Senior Care" },
  { id: "R-2004", name: "Grace Aquino", age: 24, gender: "Female", barangay: "San Antonio", risk: "Low", status: "Active", program: "Maternal Care" },
  { id: "R-2005", name: "Carlos Mendoza", age: 61, gender: "Male", barangay: "San Antonio", risk: "High", status: "Active", program: "Diabetes" },
  { id: "R-2006", name: "Liza Gonzales", age: 45, gender: "Female", barangay: "San Antonio", risk: "Medium", status: "Active", program: "TB Monitoring" },
  { id: "R-2007", name: "Pedro Reyes", age: 3, gender: "Male", barangay: "Old San Roque", risk: "Low", status: "Active", program: "Child Health" },
  { id: "R-2008", name: "Carmen Flores", age: 72, gender: "Female", barangay: "Old San Roque", risk: "High", status: "Active", program: "Senior Care" },
  { id: "R-2009", name: "Miguel Torres", age: 22, gender: "Male", barangay: "Old San Roque", risk: "Low", status: "Active", program: "Family Planning" },
  // RHU-level residents (no barangay assignment)
  { id: "R-2101", name: "Rosa Dimagiba", age: 34, gender: "Female", barangay: null, risk: "Medium", status: "Active", program: "Hypertension" },
  { id: "R-2102", name: "Andres Banaag", age: 60, gender: "Male", barangay: null, risk: "High", status: "Active", program: "Diabetes" },
];

/**
 * Referrals requiring PHN review/coordination.
 * Barangay-specific rows (Maria Santos etc.) are used by the dashboard +
 * referrals module; null-barangay rows are RHU-level referrals.
 */
export const phnReferrals = [
  // RHU-level referrals (no barangay)
  { id: 1, referralNo: "RH-2026-000301", resident: "Rosa Dimagiba", age: 34, sex: "Female", barangay: null, date: "September 5, 2026", reason: "BP re-check at RHU", facility: "RHU Pili", priority: "Medium", status: "For Review", referringPersonnel: "RHU Personnel A. Reyes", notes: "RHU-level follow-up; walk-in patient." },
  { id: 2, referralNo: "RH-2026-000302", resident: "Andres Banaag", age: 60, sex: "Male", barangay: null, date: "September 4, 2026", reason: "Diabetes medication review", facility: "RHU Pili", priority: "High", status: "For Review", referringPersonnel: "RHU Personnel A. Reyes", notes: "RHU-level diabetes review request." },
  // San Isidro
  { id: 3, referralNo: "RH-2026-000303", resident: "Elena Garcia", age: 25, sex: "Female", barangay: "San Isidro", date: "September 5, 2026", reason: "Maternal concern", facility: "Bicol Medical Center", priority: "High", status: "For Review", referringPersonnel: "Midwife M. Dela Cruz", notes: "Elevated blood pressure on latest prenatal visit. Requires specialist evaluation." },
  { id: 4, referralNo: "RH-2026-000304", resident: "Marites Ramos", age: 41, sex: "Female", barangay: "San Isidro", date: "September 4, 2026", reason: "TB symptoms", facility: "RHU Pili", priority: "High", status: "Pending", referringPersonnel: "BHW G. Aquino", notes: "Persistent cough for more than two weeks. Sputum examination requested." },
  { id: 5, referralNo: "RH-2026-000305", resident: "Kris Marquez", age: 22, sex: "Female", barangay: "San Isidro", date: "September 3, 2026", reason: "Immunization follow-through", facility: "RHU Pili", priority: "Low", status: "For Review", referringPersonnel: "BHW G. Aquino", notes: "Missed previous scheduled vaccination." },
  { id: 6, referralNo: "RH-2026-000306", resident: "Maria Santos", age: 28, sex: "Female", barangay: "San Isidro", date: "September 1, 2026", reason: "Prenatal ultrasound review", facility: "RHU Pili", priority: "Medium", status: "Accepted", referringPersonnel: "Midwife M. Dela Cruz", notes: "Scheduled for ultrasound." },
  // San Antonio
  { id: 7, referralNo: "RH-2026-000307", resident: "Dante Villar", age: 58, sex: "Male", barangay: "San Antonio", date: "September 4, 2026", reason: "Uncontrolled hypertension", facility: "RHU Pili", priority: "High", status: "For Review", referringPersonnel: "BHW L. Ramos", notes: "BP consistently above 150/95 despite medication." },
  { id: 8, referralNo: "RH-2026-000308", resident: "Grace Aquino", age: 24, sex: "Female", barangay: "San Antonio", date: "September 2, 2026", reason: "Prenatal anemia screening", facility: "RHU Pili", priority: "Medium", status: "Pending", referringPersonnel: "Midwife M. Dela Cruz", notes: "Low hemoglobin on latest check." },
  { id: 9, referralNo: "RH-2026-000309", resident: "Carlos Mendoza", age: 61, sex: "Male", barangay: "San Antonio", date: "August 28, 2026", reason: "Diabetes foot screen", facility: "Bicol Medical Center", priority: "High", status: "Completed", referringPersonnel: "BHW L. Ramos", notes: "Foot screen completed with no active ulcer." },
  // Old San Roque
  { id: 10, referralNo: "RH-2026-000310", resident: "Sofia Reyes", age: 7, sex: "Female", barangay: "Old San Roque", date: "September 5, 2026", reason: "Nutrition follow-up", facility: "RHU Pili", priority: "Medium", status: "For Review", referringPersonnel: "BHW G. Aquino", notes: "Growth monitoring shows slow weight gain." },
  { id: 11, referralNo: "RH-2026-000311", resident: "Carmen Flores", age: 72, sex: "Female", barangay: "Old San Roque", date: "September 3, 2026", reason: "Hypertension", facility: "RHU Pili", priority: "Medium", status: "Follow-up Required", referringPersonnel: "BHW L. Ramos", notes: "BP above target; needs medication review." },
  { id: 12, referralNo: "RH-2026-000312", resident: "Pedro Reyes", age: 3, sex: "Male", barangay: "Old San Roque", date: "September 1, 2026", reason: "Immunization catch-up", facility: "RHU Pili", priority: "Low", status: "Completed", referringPersonnel: "Midwife M. Dela Cruz", notes: "Catch-up series completed." },
];

/** Follow-ups monitored by the PHN (null barangay = RHU-level). */
export const phnFollowUps = [
  { id: 1, resident: "Maria Santos", age: 28, sex: "Female", barangay: "San Isidro", purpose: "Maternal Follow-up", dueDate: "Today", time: "9:00 AM", assignedTo: "Midwife M. Dela Cruz", priority: "High", status: "Due Today", notes: "BP monitoring and prenatal assessment." },
  { id: 2, resident: "Marites Ramos", age: 41, sex: "Female", barangay: "San Isidro", purpose: "TB Follow-up", dueDate: "Today", time: "10:30 AM", assignedTo: "BHW G. Aquino", priority: "High", status: "Due Today", notes: "Check sputum collection and symptoms." },
  { id: 3, resident: "Kris Marquez", age: 22, sex: "Female", barangay: "San Isidro", purpose: "Immunization Follow-up", dueDate: "Tomorrow", time: "8:30 AM", assignedTo: "Midwife M. Dela Cruz", priority: "Low", status: "Scheduled", notes: "Reschedule missed dose." },
  { id: 4, resident: "Dante Villar", age: 58, sex: "Male", barangay: "San Antonio", purpose: "NCD Follow-up", dueDate: "Today", time: "1:00 PM", assignedTo: "BHW L. Ramos", priority: "High", status: "Due Today", notes: "Blood pressure and medication review." },
  { id: 5, resident: "Grace Aquino", age: 24, sex: "Female", barangay: "San Antonio", purpose: "Maternal Follow-up", dueDate: "September 8, 2026", time: "9:00 AM", assignedTo: "Midwife M. Dela Cruz", priority: "Medium", status: "Scheduled", notes: "Anemia treatment monitoring." },
  { id: 6, resident: "Sofia Reyes", age: 7, sex: "Female", barangay: "Old San Roque", purpose: "Nutrition Follow-up", dueDate: "September 8, 2026", time: "10:00 AM", assignedTo: "BHW G. Aquino", priority: "Medium", status: "Scheduled", notes: "Weight check." },
  { id: 7, resident: "Carmen Flores", age: 72, sex: "Female", barangay: "Old San Roque", purpose: "Senior Care Follow-up", dueDate: "September 1, 2026", time: "1:00 PM", assignedTo: "BHW L. Ramos", priority: "Medium", status: "Overdue", notes: "Missed previous appointment. Contact resident." },
  { id: 8, resident: "Pedro Reyes", age: 3, sex: "Male", barangay: "Old San Roque", purpose: "Immunization Follow-up", dueDate: "September 2, 2026", time: "2:00 PM", assignedTo: "Midwife M. Dela Cruz", priority: "Low", status: "Completed", notes: "Next dose administered on schedule." },
  // RHU-level follow-ups
  { id: 9, resident: "Rosa Dimagiba", age: 34, sex: "Female", barangay: null, purpose: "RHU BP Follow-up", dueDate: "Today", time: "2:30 PM", assignedTo: "PHN A. Villanueva", priority: "Medium", status: "Due Today", notes: "RHU-level re-check." },
  { id: 10, resident: "Andres Banaag", age: 60, sex: "Male", barangay: null, purpose: "RHU Diabetes Follow-up", dueDate: "Tomorrow", time: "9:30 AM", assignedTo: "PHN A. Villanueva", priority: "High", status: "Scheduled", notes: "RHU-level medication review." },
];

/**
 * Community health alerts / early warning.
 * `barangay: null` rows are RHU-level alerts; the rest belong to one barangay.
 */
export const phnAlerts = [
  { id: 1, type: "Possible disease cluster", level: "critical", barangay: "San Isidro", cases: 5, detected: "September 4, 2026", description: "Five similar cases of fever with rash reported within the same purok this week.", status: "Under Investigation", recommendedAction: "Conduct field verification, coordinate with the sanitary inspector, and prepare a line list of cases." },
  { id: 2, type: "Increase in respiratory cases", level: "warning", barangay: "San Antonio", cases: 12, detected: "September 3, 2026", description: "Respiratory case reports increased by 40% compared with the previous period.", status: "Monitoring", recommendedAction: "Continue surveillance and remind the health station to log all cough cases of more than two weeks." },
  { id: 3, type: "Follow-up concern", level: "warning", barangay: "Old San Roque", cases: 4, detected: "September 5, 2026", description: "Several overdue follow-ups among NCD patients, mostly hypertension and diabetes.", status: "Action Needed", recommendedAction: "Coordinate with assigned BHWs to reach residents and reschedule missed follow-ups." },
  // RHU-level alert (visible to unassigned PHN)
  { id: 4, type: "Elevated RHU consultation volume", level: "warning", barangay: null, cases: 26, detected: "September 5, 2026", description: "RHU consultation volume is above the weekly average; mostly respiratory complaints.", status: "Monitoring", recommendedAction: "Monitor staffing and medicine stock; escalate to the MHO if the trend continues." },
];

/** Health services (null barangay = RHU-level service at the RHU main). */
export const phnHealthServices = [
  { id: "SVC-101", name: "Immunization", barangay: "San Isidro", count: "12 scheduled", personnel: "Midwife M. Dela Cruz", date: "Today", time: "9:00 AM", status: "Scheduled", notes: "Routine childhood immunization session at BHS." },
  { id: "SVC-102", name: "Maternal Care", barangay: "San Antonio", count: "6 scheduled", personnel: "Midwife M. Dela Cruz", date: "Today", time: "10:00 AM", status: "Ongoing", notes: "Prenatal check-ups at the health station." },
  { id: "SVC-103", name: "BP Screening", barangay: "Old San Roque", count: "15 completed", personnel: "BHW G. Aquino", date: "Today", time: "8:00 AM", status: "Completed", notes: "Community-based blood pressure screening." },
  { id: "SVC-104", name: "Nutrition Monitoring", barangay: "San Isidro", count: "8 scheduled", personnel: "BHW L. Ramos", date: "Today", time: "1:00 PM", status: "Scheduled", notes: "Operation Timbang for under-five children." },
  { id: "SVC-105", name: "Health Education", barangay: "San Antonio", count: "2 sessions", personnel: "PHN A. Villanueva", date: "Today", time: "2:30 PM", status: "Scheduled", notes: "Dengue prevention and healthy lifestyle sessions." },
  // RHU-level services (RHU main)
  { id: "SVC-106", name: "RHU General Consultation", barangay: null, count: "10 scheduled", personnel: "PHN A. Villanueva", date: "Today", time: "8:00 AM", status: "Ongoing", notes: "Walk-in consultations at the RHU main." },
  { id: "SVC-107", name: "RHU NCD Clinic", barangay: null, count: "6 scheduled", personnel: "PHN A. Villanueva", date: "Today", time: "1:00 PM", status: "Scheduled", notes: "RHU-level hypertension and diabetes clinic." },
];

/** Assessments logged by field personnel, reviewed by the PHN. */
export const phnAssessments = [
  { id: 1, resident: "Maria Santos", age: 28, barangay: "San Isidro", date: "September 5, 2026", type: "Prenatal Assessment", findings: "BP 140/90, slight ankle edema.", assessedBy: "Midwife M. Dela Cruz", status: "For Review", notes: "Repeat BP after 15 minutes rest." },
  { id: 2, resident: "Marites Ramos", age: 41, barangay: "San Isidro", date: "September 4, 2026", type: "TB Symptom Screening", findings: "Persistent cough 3 weeks, night sweats.", assessedBy: "BHW G. Aquino", status: "For Review", notes: "Sputum collection scheduled." },
  { id: 3, resident: "Grace Aquino", age: 24, barangay: "San Antonio", date: "September 4, 2026", type: "Prenatal Assessment", findings: "Low hemoglobin, pallor noted.", assessedBy: "BHW L. Ramos", status: "For Review", notes: "Start iron supplementation." },
  { id: 4, resident: "Dante Villar", age: 58, barangay: "San Antonio", date: "September 3, 2026", type: "NCD Risk Assessment", findings: "BP 155/95, BMI 27.4.", assessedBy: "BHW L. Ramos", status: "Validated", notes: "Medication adherence to be confirmed." },
  { id: 5, resident: "Carmen Flores", age: 72, barangay: "Old San Roque", date: "September 3, 2026", type: "NCD Risk Assessment", findings: "BP 158/92.", assessedBy: "BHW G. Aquino", status: "For Review", notes: "Needs medication review." },
  { id: 6, resident: "Sofia Reyes", age: 7, barangay: "Old San Roque", date: "September 2, 2026", type: "Growth Monitoring", findings: "Weight below expected percentile.", assessedBy: "BHW L. Ramos", status: "For Review", notes: "Nutrition referral under review." },
  { id: 7, resident: "Pedro Reyes", age: 3, barangay: "Old San Roque", date: "September 2, 2026", type: "Growth Monitoring", findings: "Weight within normal range for age.", assessedBy: "BHW L. Ramos", status: "Validated", notes: "Next monitoring in one quarter." },
  // RHU-level assessments
  { id: 8, resident: "Rosa Dimagiba", age: 34, barangay: null, date: "September 5, 2026", type: "BP Re-check", findings: "BP 145/92 at RHU.", assessedBy: "RHU Personnel A. Reyes", status: "For Review", notes: "RHU-level assessment." },
  { id: 9, resident: "Andres Banaag", age: 60, barangay: null, date: "September 4, 2026", type: "Diabetes Review", findings: "FBS 170 mg/dL.", assessedBy: "RHU Personnel A. Reyes", status: "Validated", notes: "RHU-level medication review." },
];

/** PHN notifications (scope-sensitive; barangay null = RHU-level event). */
export const phnNotifications = [
  { id: 1, icon: "Send", title: "New RHU referral requires review", desc: "New RHU-level referral requires review.", time: "1 hour ago", category: "information", read: false, barangay: null },
  { id: 2, icon: "AlertTriangle", title: "Referral needs review", desc: "New referral from San Isidro requires review. Patient: Elena Garcia.", time: "1 hour ago", category: "information", read: false, barangay: "San Isidro" },
  { id: 3, icon: "Activity", title: "Check-up queue waiting", desc: "San Isidro patient Marites Ramos is waiting for PHN check-up.", time: "30 minutes ago", category: "reminder", read: false, barangay: "San Isidro" },
  { id: 4, icon: "AlertTriangle", title: "Follow-up overdue", desc: "Follow-up overdue in San Antonio. Patient: Dante Villar.", time: "3 hours ago", category: "alert", read: false, barangay: "San Antonio" },
  { id: 5, icon: "CheckCircle", title: "Referral completed", desc: "Referral for Pedro Reyes (Old San Roque) has been completed.", time: "1 day ago", category: "success", read: true, barangay: "Old San Roque" },
  { id: 6, icon: "CalendarClock", title: "Follow-ups due today", desc: "2 RHU-level follow-ups are due today.", time: "1 day ago", category: "reminder", read: true, barangay: null },
];

/** PHN report summaries scoped to the three barangays. */
export const phnReportSummary = [
  { label: "Residents Monitored", value: "1,248" },
  { label: "Active Health Cases", value: "86" },
  { label: "Pending Referrals", value: "12" },
  { label: "Follow-ups Due This Week", value: "24" },
  { label: "Health Services Today", value: "18" },
  { label: "Priority Cases", value: "7" },
];

/** Monthly trend series. Keys: rhu + each barangay. */
export const phnMonthlyTrend = [
  { month: "Apr", rhu: 8, "San Isidro": 15, "San Antonio": 9, "Old San Roque": 6 },
  { month: "May", rhu: 8, "San Isidro": 16, "San Antonio": 10, "Old San Roque": 6 },
  { month: "Jun", rhu: 9, "San Isidro": 17, "San Antonio": 10, "Old San Roque": 7 },
  { month: "Jul", rhu: 9, "San Isidro": 17, "San Antonio": 11, "Old San Roque": 7 },
  { month: "Aug", rhu: 10, "San Isidro": 18, "San Antonio": 11, "Old San Roque": 7 },
  { month: "Sep", rhu: 10, "San Isidro": 18, "San Antonio": 11, "Old San Roque": 7 },
];
