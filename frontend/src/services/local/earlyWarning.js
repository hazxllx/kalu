/**
 * Local (non-demo) Early Warning datasets.
 *
 * This module carries no demo data. Every collection starts empty and the UI
 * shows an empty/loading state until the backend endpoint
 * (`GET /api/analytics/early-warning`) supplies real rows. Export names and
 * object shapes are preserved from the previous development module so the Early
 * Warning page and its `resolveEarlyWarningData` entry point keep working.
 *
 * `resolveEarlyWarningData(assignedBarangay)` remains the ONLY way the page
 * obtains data; the barangay argument comes from the signed-in user's
 * assignment (`@/lib/barangayScope`).
 */

export const MUNICIPAL_EARLY_WARNING = {
  scope: null,
  summary: [],
  consultationTrends: [],
  diseaseDistribution: [],
  barangayComparison: [],
  barangayCards: [],
  statusCards: [],
  referralCompletion: [],
  maternalTrend: [],
  childHealthCoverage: [],
  seniorTrend: [],
  programParticipation: [],
  monthlyConsultations: [],
  monthlyReferrals: [],
  riskDistribution: [],
  diseasesByBarangay: [],
  programCompliance: [],
};

/**
 * Barangay datasets for barangay-scoped callers. The curated entry is kept as
 * an empty-but-shaped record; any other assignment falls back to the generic
 * empty profile produced by `buildBarangayDataset`.
 */
export const BARANGAY_EARLY_WARNING = {
  "San Isidro": {
    scope: "",
    summary: {
      consultationsThisMonth: { value: "", change: "", up: false },
      referralsThisMonth: { value: "", change: "", up: false },
      topCondition: { name: "", cases: "" },
      highRiskResidents: { value: "", change: "", up: false },
    },
    consultationTrends: [],
    diseaseDistribution: [],
    riskDistribution: [],
    maternalTrend: [],
    seniorTrend: [],
    programCompliance: [],
    barangayOverview: {
      name: "",
      status: "",
      tone: "",
      dot: "",
      residents: "",
      consultations: "",
      description: "",
    },
  },
};

/** Generic empty profile for an assignment without a curated dataset. */
const buildBarangayDataset = (barangay) => ({
  scope: barangay,
  summary: {
    consultationsThisMonth: { value: "â€”", change: "No data yet", up: true },
    referralsThisMonth: { value: "â€”", change: "No data yet", up: true },
    topCondition: { name: "Not enough data", cases: "â€”" },
    highRiskResidents: { value: "â€”", change: "No data yet", up: false },
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
 * user's assignment â€” null returns the municipal dataset (MHO).
 */
export const resolveEarlyWarningData = (assignedBarangay) =>
  assignedBarangay
    ? BARANGAY_EARLY_WARNING[assignedBarangay] || buildBarangayDataset(assignedBarangay)
    : MUNICIPAL_EARLY_WARNING;

export default { MUNICIPAL_EARLY_WARNING, BARANGAY_EARLY_WARNING, resolveEarlyWarningData };
