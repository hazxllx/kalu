/** Integer versions are preferred; timestamps support existing encrypted drafts. */
export const residentRevisionOf = (resident) => {
  if (Number.isInteger(resident?.revision) && resident.revision > 0) return resident.revision;
  const timestamp = resident?.updatedAt;
  return typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(timestamp) && Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : null;
};

export const isResidentRevision = (value) =>
  (Number.isInteger(value) && value > 0 && value <= 2147483647) ||
  (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
