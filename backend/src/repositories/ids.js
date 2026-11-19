/**
 * Human-readable identifier helpers shared across KALUSAGAP repository drivers.
 *
 * Used at the persistence layer (`route -> authenticate -> authorize ->
 * controller -> service -> repository`) so sequential counter values from
 * either the local JSON store (`fileRepository`) or PostgreSQL `record_counters`
 * (`supabaseRepository`) produce identical domain identifiers (`RES-`, `RHU-`,
 * `SUB-`, `REF-`).
 */

/** Zero-pads a sequential counter integer `n` to `width` digits (default 6). */
export const pad = (n, width = 6) => String(n).padStart(width, '0');

/** Formats sequential counter `n` as a permanent Resident ID (`RES-000001`). */
export const residentId = (n) => `RES-${pad(n)}`;

/** Formats sequential counter `n` as an RHU Health Record Number (`RHU-000001`). */
export const healthRecordNo = (n) => `RHU-${pad(n)}`;

/** Formats sequential counter `n` as a clinical visit/submission ID (`SUB-000001`). */
export const submissionId = (n) => `SUB-${pad(n)}`;

/** Formats sequential counter `n` as a referral ID (`REF-000001`). */
export const referralId = (n) => `REF-${pad(n)}`;

/**
 * Extracts the numeric counter suffix after the `-` prefix (e.g., `'RES-000042'` -> `42`),
 * returning `0` when the identifier is empty or lacks a numeric suffix.
 */
export const numericPart = (id = '') => Number(String(id).split('-')[1] || 0);

export default { pad, residentId, healthRecordNo, submissionId, referralId, numericPart };
