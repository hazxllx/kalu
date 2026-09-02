/**
 * Human-readable identifier helpers shared across repository drivers.
 */
export const pad = (n, width = 6) => String(n).padStart(width, '0');

export const residentId = (n) => `RES-${pad(n)}`;
export const healthRecordNo = (n) => `RHU-${pad(n)}`;
export const submissionId = (n) => `SUB-${pad(n)}`;
export const referralId = (n) => `REF-${pad(n)}`;

export const numericPart = (id = '') => Number(String(id).split('-')[1] || 0);

export default { pad, residentId, healthRecordNo, submissionId, referralId, numericPart };
