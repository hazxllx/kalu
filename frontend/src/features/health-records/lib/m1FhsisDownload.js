/**
 * KALUSAGAP — M1 FHSIS Report API Integration
 * Fetches monthly report data and metadata, then generates the 9-page PDF.
 */

import { m1Api } from "@/services/api";
import { downloadM1FhsisReport } from "./m1Report.js";

/**
 * Fetch report data and trigger PDF download.
 * 
 * @param {object} params
 * @param {number} params.year
 * @param {number} params.month  1-12
 * @param {string} [params.barangay]
 */
export const downloadM1Fhsis = async ({ year, month, barangay }) => {
  const [monthlyData, meta] = await Promise.all([
    m1Api.monthly({ year, month }).catch(() => ({})),
    m1Api.getMeta({ year, month }).catch(() => null),
  ]);
  
  downloadM1FhsisReport({ monthlyData, meta, barangay, year, month });
};

export default { downloadM1Fhsis };