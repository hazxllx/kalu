/**
 * Local (non-demo) dashboard and analytics datasets.
 *
 * This module carries no demo data. Every collection starts empty and the UI
 * shows an empty/loading state until the corresponding backend endpoint
 * supplies real rows. Export names and object shapes are preserved from the
 * previous development module so existing pages keep compiling and consumers never
 * read `undefined`.
 *
 * `features`, `services` and `howItWorks` are static UI copy (icon + label
 * configuration), not records, so they are kept as product configuration.
 */

export const stats = {
  landing: [],
};

// Static landing-page copy (icon + label configuration) â€” not a data record.
export const features = [
  { icon: "FileHeart", title: "Resident Health Records", desc: "Centralized, secure health records for every resident in the barangay." },
  { icon: "Home", title: "Household Profiling", desc: "Capture household conditions, water, sanitation and risk factors." },
  { icon: "Activity", title: "Risk Monitoring", desc: "Automatically flag high-risk residents needing closer attention." },
  { icon: "HeartPulse", title: "Early Intervention", desc: "Act early with guided care pathways and priority alerts." },
  { icon: "CalendarClock", title: "Follow-up Scheduling", desc: "Never miss a visit with smart follow-up reminders." },
  { icon: "RefreshCw", title: "Offline Sync", desc: "Work in remote areas â€” data syncs automatically when online." },
];

// Static service registry copy (icon + service name) â€” not a data record.
export const services = [
  { icon: "Stethoscope", name: "Medical Consultation" },
  { icon: "Smile", name: "Dental Services" },
  { icon: "Syringe", name: "Immunization" },
  { icon: "Eye", name: "Risk Assessment / Visual Acuity / PWD Screening" },
  { icon: "Pill", name: "Distribution of Hypertension / Diabetic Medication" },
  { icon: "Activity", name: "Cervical Screening" },
  { icon: "Scale", name: "Nutrition Operation Timbang" },
  { icon: "Worm", name: "Nutrition Deworming" },
  { icon: "Vitamin", name: "Nutrition Micronutrient Supplement" },
  { icon: "Lungs", name: "TB Program" },
  { icon: "HeartHandshake", name: "Family Planning" },
  { icon: "Baby", name: "Pre-Natal" },
  { icon: "User", name: "Adolescent Health" },
  { icon: "Shield", name: "HIV Screening (as scheduled)" },
  { icon: "Dog", name: "Anti-Rabies Vaccination" },
];

// Static onboarding copy (icon + label configuration) â€” not a data record.
export const howItWorks = [
  { icon: "UserPlus", title: "Register Residents", desc: "Enroll residents and households into the barangay registry." },
  { icon: "ClipboardList", title: "Record Health Information", desc: "Log vitals, consultations, and medical history." },
  { icon: "Activity", title: "Monitor Health Risks", desc: "Track risk levels across the community in real time." },
  { icon: "CalendarCheck", title: "Schedule Follow-ups", desc: "Plan visits and keep residents on their care journey." },
];

export const residentTimeline = [];

export const residentDashboard = {
  followUp: { date: "", time: "", place: "" },
  bhw: "",
  risk: "",
  lastCheck: "",
  healthStatus: { status: "", score: 0, note: "" },
  latestConsultation: { date: "", type: "", provider: "", diagnosis: "", status: "" },
};

export const recentMedicalRecords = [];

export const appointments = [];

export const notifications = [];

export const residents = [];

export const households = [];

export const bhwDashboard = [];

export const midwifeStats = [];

export const healthServices = [];

export const barangayServices = [];

export const m1Records = [];

export const followUps = [];

export const referrals = [];

export const immunizations = [];

export const immunizationSessions = [];

export const monthlyConsultations = [];

export const topDiseases = [];

export const vaccinationCoverage = [];

export const barangayOverview = [];

export const adminStats = [];

export const auditLogs = [];

export const systemUsers = [];

// === RHU Analytics: Community Health Map & Trends ===

export const highlightedBarangays = [];

export const comparisonMonthlyConsultations = [];

export const diseaseDonutData = [];

export const comparisonFollowUpTrend = [];

export const comparisonVaccinationCoverage = [];

export const comparisonReferralCompletion = [];

export const comparisonMaternalTrend = [];

export const comparisonChildHealth = [];

export const comparisonSeniorTrend = [];

export const comparisonProgramParticipation = [];

export const healthStatusSummary = [];

export const recentHealthAlerts = [];
