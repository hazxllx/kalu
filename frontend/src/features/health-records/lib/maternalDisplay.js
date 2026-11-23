export const hasRecordedMaternalValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && !["—", "not recorded", "result not recorded"].includes(normalized);
};

export const recordedMaternalRows = (rows) =>
  rows.filter(([, value]) => hasRecordedMaternalValue(value));

export const maternalScreeningValue = (date, result) =>
  [date, result].filter(hasRecordedMaternalValue).join(" · ");
