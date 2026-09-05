/**
 * Early Warning datasets (development mock).
 *
 * `resolveEarlyWarningData(assignedBarangay)` is the ONLY way the Early
 * Warning page obtains data. The barangay argument comes from the signed-in
 * user's assignment (see `@/lib/barangayScope`) — the page itself has no
 * barangay selector and cannot request another barangay's dataset. The real
 * enforcement lives in the API (`GET /api/analytics/early-warning` derives
 * the scope from the session); this mock mirrors it for local development.
 */

export const MUNICIPAL_EARLY_WARNING = {
  scope: null,
  summary: [
    { label: "Consultations This Month", value: "312", change: "+8.2%", up: true },
    { label: "Referrals This Month", value: "24", change: "+3.1%", up: true },
    { label: "Top Condition", value: "Hypertension", change: "342 cases", up: true },
    { label: "High-Risk Residents", value: "47", change: "-2.1%", up: false },
  ],
  consultationTrends: [
    { month: "Aug", consultations: 245, referrals: 18 }, { month: "Sep", consultations: 268, referrals: 22 },
    { month: "Oct", consultations: 254, referrals: 19 }, { month: "Nov", consultations: 289, referrals: 25 },
    { month: "Dec", consultations: 276, referrals: 21 }, { month: "Jan", consultations: 298, referrals: 23 },
    { month: "Feb", consultations: 312, referrals: 26 }, { month: "Mar", consultations: 305, referrals: 24 },
    { month: "Apr", consultations: 324, referrals: 28 }, { month: "May", consultations: 318, referrals: 25 },
    { month: "Jun", consultations: 335, referrals: 27 }, { month: "Jul", consultations: 312, referrals: 24 },
  ],
  diseaseDistribution: [
    { name: "Hypertension", value: 342, color: "#0B5CAD" },
    { name: "Diabetes", value: 189, color: "#2A7DE1" },
    { name: "Respiratory", value: 156, color: "#F5B400" },
    { name: "Malnutrition", value: 98, color: "#28B463" },
    { name: "Anemia", value: 74, color: "#E74C3C" },
    { name: "Others", value: 120, color: "#5B6472" },
  ],
  barangayComparison: [
    { barangay: "San Antonio", consultations: 642, referrals: 38, highRisk: 12 },
    { barangay: "San Isidro", consultations: 528, referrals: 31, highRisk: 9 },
    { barangay: "Old San Roque", consultations: 489, referrals: 28, highRisk: 8 },
  ],
  barangayCards: [
    { name: "San Antonio", dot: "bg-brand-green", tone: "text-brand-green bg-brand-green/10", status: "Healthy", residents: "4,215 residents", consultations: "168 consultations" },
    { name: "San Isidro", dot: "bg-brand-blue", tone: "text-brand-blue bg-brand-blue/10", status: "Stable", residents: "3,486 residents", consultations: "142 consultations" },
    { name: "Old San Roque", dot: "bg-brand-accent", tone: "text-brand-accent bg-brand-accent/10", status: "Needs Attention", residents: "5,144 residents", consultations: "213 consultations" },
  ],
  statusCards: [
    { dot: "bg-brand-green", title: "Healthy", value: "4,215", percent: "33%", text: "text-brand-green", description: "All health indicators within normal range. Consistent follow-up compliance and high vaccination coverage." },
    { dot: "bg-brand-blue", title: "Stable", value: "3,486", percent: "27%", text: "text-brand-blue", description: "Most indicators remain stable with minor fluctuations. Follow-up completion remains consistent." },
    { dot: "bg-brand-accent", title: "Needs Attention", value: "5,144", percent: "40%", text: "text-brand-accent", description: "Higher risk indicators detected. Increased hypertension and diabetes cases require monitoring." },
  ],
  referralCompletion: [
    { barangay: "San Antonio", rate: 82 },
    { barangay: "San Isidro", rate: 76 },
    { barangay: "Old San Roque", rate: 80 },
  ],
  maternalTrend: [
    { month: "Jan", sanAntonio: 45, sanIsidro: 38, oldSanRoque: 40 },
    { month: "Feb", sanAntonio: 52, sanIsidro: 41, oldSanRoque: 44 },
    { month: "Mar", sanAntonio: 48, sanIsidro: 44, oldSanRoque: 47 },
    { month: "Apr", sanAntonio: 55, sanIsidro: 46, oldSanRoque: 49 },
    { month: "May", sanAntonio: 50, sanIsidro: 42, oldSanRoque: 45 },
    { month: "Jun", sanAntonio: 58, sanIsidro: 49, oldSanRoque: 51 },
  ],
  childHealthCoverage: [
    { barangay: "San Antonio", services: 95 },
    { barangay: "San Isidro", services: 88 },
    { barangay: "Old San Roque", services: 84 },
  ],
  seniorTrend: [
    { month: "Jan", sanAntonio: 32, sanIsidro: 28, oldSanRoque: 29 },
    { month: "Feb", sanAntonio: 35, sanIsidro: 30, oldSanRoque: 31 },
    { month: "Mar", sanAntonio: 38, sanIsidro: 32, oldSanRoque: 33 },
    { month: "Apr", sanAntonio: 40, sanIsidro: 34, oldSanRoque: 35 },
    { month: "May", sanAntonio: 42, sanIsidro: 36, oldSanRoque: 37 },
    { month: "Jun", sanAntonio: 45, sanIsidro: 38, oldSanRoque: 39 },
  ],
  programParticipation: [
    { barangay: "San Antonio", maternal: 85, immunization: 92, nutrition: 78, tb: 88, familyPlanning: 75 },
    { barangay: "San Isidro", maternal: 78, immunization: 85, nutrition: 72, tb: 82, familyPlanning: 68 },
    { barangay: "Old San Roque", maternal: 75, immunization: 83, nutrition: 70, tb: 79, familyPlanning: 67 },
  ],
  monthlyConsultations: [
    { month: "Jan", sanAntonio: 52, sanIsidro: 45, oldSanRoque: 42 },
    { month: "Feb", sanAntonio: 58, sanIsidro: 50, oldSanRoque: 46 },
    { month: "Mar", sanAntonio: 55, sanIsidro: 48, oldSanRoque: 44 },
    { month: "Apr", sanAntonio: 62, sanIsidro: 54, oldSanRoque: 49 },
    { month: "May", sanAntonio: 60, sanIsidro: 52, oldSanRoque: 47 },
    { month: "Jun", sanAntonio: 65, sanIsidro: 56, oldSanRoque: 52 },
  ],
  monthlyReferrals: [
    { month: "Jan", sanAntonio: 8, sanIsidro: 6, oldSanRoque: 6 },
    { month: "Feb", sanAntonio: 9, sanIsidro: 7, oldSanRoque: 7 },
    { month: "Mar", sanAntonio: 10, sanIsidro: 8, oldSanRoque: 8 },
    { month: "Apr", sanAntonio: 11, sanIsidro: 9, oldSanRoque: 9 },
    { month: "May", sanAntonio: 12, sanIsidro: 10, oldSanRoque: 10 },
    { month: "Jun", sanAntonio: 13, sanIsidro: 11, oldSanRoque: 11 },
  ],
  riskDistribution: [
    { name: "Low Risk", value: 45, color: "#28B463" },
    { name: "Moderate Risk", value: 30, color: "#0B5CAD" },
    { name: "High Risk", value: 18, color: "#F5B400" },
    { name: "Critical", value: 7, color: "#E74C3C" },
  ],
  diseasesByBarangay: [
    { barangay: "San Antonio", hypertension: 85, diabetes: 52, respiratory: 38, malnutrition: 22, anemia: 18 },
    { barangay: "San Isidro", hypertension: 72, diabetes: 45, respiratory: 32, malnutrition: 18, anemia: 15 },
    { barangay: "Old San Roque", hypertension: 70, diabetes: 43, respiratory: 30, malnutrition: 17, anemia: 14 },
  ],
  programCompliance: [
    { program: "Prenatal", rate: 82 },
    { program: "Immunization", rate: 89 },
    { program: "Nutrition", rate: 76 },
    { program: "TB", rate: 84 },
    { program: "Family Planning", rate: 71 },
  ],
};

/**
 * Barangay datasets for barangay-scoped callers. The Health Supervisor demo
 * account is assigned to San Isidro, so San Isidro carries a curated dataset;
 * any other assignment falls back to a generic barangay profile.
 */
export const BARANGAY_EARLY_WARNING = {
  "San Isidro": {
    scope: "San Isidro",
    summary: {
      consultationsThisMonth: { value: "64", change: "+5.0%", up: true },
      referralsThisMonth: { value: "5", change: "+8.3%", up: true },
      topCondition: { name: "Hypertension", cases: "72 cases" },
      highRiskResidents: { value: "9", change: "-1.1%", up: false },
    },
    consultationTrends: [
      { month: "Aug", consultations: 48, referrals: 4 }, { month: "Sep", consultations: 51, referrals: 5 },
      { month: "Oct", consultations: 49, referrals: 4 }, { month: "Nov", consultations: 54, referrals: 5 },
      { month: "Dec", consultations: 52, referrals: 5 }, { month: "Jan", consultations: 56, referrals: 5 },
      { month: "Feb", consultations: 58, referrals: 5 }, { month: "Mar", consultations: 57, referrals: 5 },
      { month: "Apr", consultations: 60, referrals: 6 }, { month: "May", consultations: 59, referrals: 5 },
      { month: "Jun", consultations: 62, referrals: 5 }, { month: "Jul", consultations: 64, referrals: 5 },
    ],
    diseaseDistribution: [
      { name: "Hypertension", value: 72, color: "#0B5CAD" },
      { name: "Diabetes", value: 45, color: "#2A7DE1" },
      { name: "Respiratory", value: 32, color: "#F5B400" },
      { name: "Malnutrition", value: 18, color: "#28B463" },
      { name: "Anemia", value: 15, color: "#E74C3C" },
      { name: "Others", value: 26, color: "#5B6472" },
    ],
    riskDistribution: [
      { name: "Low Risk", value: 61, color: "#28B463" },
      { name: "Moderate Risk", value: 28, color: "#0B5CAD" },
      { name: "High Risk", value: 11, color: "#F5B400" },
    ],
    maternalTrend: [
      { month: "Jan", count: 38 }, { month: "Feb", count: 41 }, { month: "Mar", count: 44 },
      { month: "Apr", count: 46 }, { month: "May", count: 42 }, { month: "Jun", count: 49 },
    ],
    seniorTrend: [
      { month: "Jan", count: 28 }, { month: "Feb", count: 30 }, { month: "Mar", count: 32 },
      { month: "Apr", count: 34 }, { month: "May", count: 36 }, { month: "Jun", count: 38 },
    ],
    programCompliance: [
      { program: "Prenatal", rate: 78 },
      { program: "Immunization", rate: 85 },
      { program: "Nutrition", rate: 72 },
      { program: "TB", rate: 82 },
      { program: "Family Planning", rate: 68 },
    ],
    barangayOverview: {
      name: "San Isidro",
      status: "Stable",
      tone: "text-brand-blue bg-brand-blue/10",
      dot: "bg-brand-blue",
      residents: "3,486 residents",
      consultations: "142 consultations",
      description: "Most indicators remain stable with minor fluctuations. Follow-up completion remains consistent.",
    },
  },
};

/** Generic profile for an assignment without a curated dataset. */
const buildBarangayDataset = (barangay) => ({
  scope: barangay,
  summary: {
    consultationsThisMonth: { value: "—", change: "No data yet", up: true },
    referralsThisMonth: { value: "—", change: "No data yet", up: true },
    topCondition: { name: "Not enough data", cases: "—" },
    highRiskResidents: { value: "—", change: "No data yet", up: false },
  },
  consultationTrends: [],
  diseaseDistribution: [],
  riskDistribution: [],
  maternalTrend: [],
  seniorTrend: [],
  programCompliance: [],
  barangayOverview: {
    name: barangay,
    status: "Monitoring",
    tone: "text-brand-gray bg-brand-gray/10",
    dot: "bg-brand-gray",
    residents: "No records yet",
    consultations: "No consultations recorded",
    description: "No analytics have been submitted for this barangay yet.",
  },
});

/**
 * The dataset a caller may see. `assignedBarangay` comes from the signed-in
 * user's assignment — null returns the municipal dataset (MHO).
 */
export const resolveEarlyWarningData = (assignedBarangay) =>
  assignedBarangay
    ? BARANGAY_EARLY_WARNING[assignedBarangay] || buildBarangayDataset(assignedBarangay)
    : MUNICIPAL_EARLY_WARNING;

export default { MUNICIPAL_EARLY_WARNING, BARANGAY_EARLY_WARNING, resolveEarlyWarningData };
