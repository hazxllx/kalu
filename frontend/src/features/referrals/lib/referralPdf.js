import { loadDocumentBranding } from "@/lib/documentBranding";
import { renderReferralPdf } from "./referralPdfRenderer";

/**
 * Official Referral Form PDF — download wrapper.
 *
 * Loads the centralized document branding (Admin-uploaded municipality / RHU
 * logos + dynamic organization and signatory data), renders the official
 * government/LGU Referral Form with the pure renderer
 * (referralPdfRenderer.js), and triggers the PDF download.
 */

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * @param {object} referral  saved health_referrals row (snake_case)
 * @param {{ residents?: Array }} [options] resident roster used to enrich the
 *   patient details via the referral's residentId (optional)
 */
export async function downloadReferralPdf(referral, { residents = [] } = {}) {
  if (!referral) return;

  // Enrich the patient details from the roster when the row only carries a
  // residentId (the API normally embeds `resident` already).
  const linked = referral.residentId
    ? residents.find((r) => r.id === referral.residentId)
    : null;
  const enriched = linked ? { ...referral, resident: { ...(referral.resident || {}), ...linked } } : referral;

  const branding = await loadDocumentBranding("barangay_rhu_referral");
  const doc = renderReferralPdf(enriched, branding);
  if (!doc) return;

  const referralNo = str(enriched.referralNo || enriched.reference_no) || "";
  doc.save(referralNo ? `Referral-${referralNo}.pdf` : "Referral-Form.pdf");
}

export default downloadReferralPdf;