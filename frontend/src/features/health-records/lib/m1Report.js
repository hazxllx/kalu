import { buildM1FhsisModel } from "./m1FhsisFormModel.js";
import { renderM1FhsisPdf } from "./m1FhsisPdfRenderer.js";
import { loadDocumentBranding } from "@/lib/documentBranding";

/**
 * KALUSAGAP — FHSIS M1 Complete 9-Page Report
 *
 * Generates the official FHSIS Monthly Form M1 as a fixed-layout, landscape,
 * 9-page PDF with selectable text and real table cells:
 *
 * - Page 1: Section A — Family Planning (incl. the horizontal FP matrix)
 * - Page 2: Section B — Maternal Care (B1 Prenatal, B2 Intrapartum)
 * - Page 3: Section B (B3 Postpartum) + Section C — Child Care
 * - Page 4: Section C — Immunization / School-Based / Nutrition
 * - Page 5: Nutrition (continued) / Sick Children / Section D — Oral Health
 * - Page 6: Oral Health (Pregnant Women) + Section E — NCD (E1–E5)
 * - Page 7: Section E (E6–E8) + Section F — Environmental Health
 * - Page 8: Section G — Infectious Disease
 * - Page 9: Section H — Vital Statistics (incl. Teenage Pregnancy matrix)
 *
 * Data comes from the existing M1 monthly report API (`m1Api.monthly()`) and
 * the report metadata API (`m1Api.getMeta()`); no values are invented and no
 * sample geography is hardcoded.
 */

const str = (v) => (v === undefined || v === null ? "" : String(v));

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Build the M1 FHSIS form model and render the 9-page PDF. Returns the jsPDF
 * document (unsaved) so callers can save, preview or print it.
 *
 * @param {object} args
 * @param {object} args.monthlyData  response of m1Api.monthly() ({ byCode, indicators, ... })
 * @param {object} [args.meta]       response of m1Api.getMeta() (barangay/municipality/province/meta)
 * @param {string} [args.barangay]   barangay name fallback
 * @param {number} args.year
 * @param {number} args.month        1-12
 */
export const renderM1FhsisDoc = async ({ monthlyData = {}, meta = null, barangay = "", year, month }) => {
  const model = buildM1FhsisModel(monthlyData, meta || {}, { year, month, barangay });
  const branding = await loadDocumentBranding("fhsis_m1");
  return renderM1FhsisPdf(model, branding);
};

/**
 * Build and download the complete 9-page FHSIS M1 PDF.
 *
 * @param {object} args — same as renderM1FhsisDoc
 */
export const downloadM1FhsisReport = async ({ monthlyData = {}, meta = null, barangay = "", year, month } = {}) => {
  const doc = await renderM1FhsisDoc({ monthlyData, meta, barangay, year, month });
  const safeBarangay = str(barangay).replace(/[^\w-]+/g, "_") || "all-barangays";
  const suffix = `${year}-${String(month ?? 1).padStart(2, "0")}`;
  doc.save(`M1-FHSIS-Report-${safeBarangay}-${suffix}.pdf`);
};

export default { renderM1FhsisDoc, downloadM1FhsisReport };
