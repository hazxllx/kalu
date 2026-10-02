/**
 * KALUSAGAP — FHSIS M1 Form Model Builder
 * Builds the data model for the 9-page FHSIS M1 form from API data
 */

export const buildM1FhsisModel = (monthlyData = {}, meta = {}, ctx = {}) => {
  const { year = new Date().getFullYear(), month = new Date().getMonth() + 1, barangay = "" } = ctx;
  
  const MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  
  const periodLabel = `${MONTH_LABELS[month - 1]} ${year}`;
  const byCode = monthlyData?.byCode || {};
  const indicators = monthlyData?.indicators || [];
  
  const getValue = (code, field = "total") => {
    const ind = byCode[code];
    if (!ind) return 0;
    return field === "total" ? (ind.total ?? 0) : (ind[field] ?? 0);
  };
  
  const getByAge = (code) => {
    const ind = byCode[code];
    if (!ind || !ind.byAge) return { "10-14": 0, "15-19": 0, "20-49": 0 };
    return { "10-14": ind.byAge["10-14"] ?? 0, "15-19": ind.byAge["15-19"] ?? 0, "20-49": ind.byAge["20-49"] ?? 0 };
  };
  
  const getBySex = (code) => {
    const ind = byCode[code];
    if (!ind || !ind.bySex) return { Male: 0, Female: 0 };
    return { Male: ind.bySex.Male ?? 0, Female: ind.bySex.Female ?? 0 };
  };
  
  return {
    periodLabel,
    year,
    month,
    barangay,
    meta,
    getValue,
    getByAge,
    getBySex,
    byCode,
    indicators,
  };
};

export default { buildM1FhsisModel };