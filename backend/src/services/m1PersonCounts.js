/**
 * KALUSAGAP — M1 person-based counting engine.
 *
 * This module implements the "QUALIFYING PERSON → MATCH RULE → +1 → AGE GROUP
 * → TOTAL" behaviour that the M1/FHSIS report requires. It never copies raw
 * database rows into the form: it determines whether a PERSON qualifies for an
 * indicator, de-duplicates by a unique key (resident_id), buckets them into an
 * age group computed from their birth date at the reporting reference date,
 * and sums the buckets into a Total.
 *
 * Pure / dependency-free so it is fully unit-testable in Node (mirrors the
 * rest of the M1 service which injects a fake Supabase client).
 *
 * Counting units:
 *   PERSON   -> count each unique qualifying resident once (dedup by uniqueKey)
 *   EVENT    -> count each qualifying record/event (e.g. deliveries, visits)
 *   HOUSEHOLD-> count each unique qualifying household (dedup by household id)
 *   AGGREGATE-> a value supplied from another layer (not counted row-by-row)
 */

export const COUNTING_UNITS = Object.freeze(['PERSON', 'EVENT', 'HOUSEHOLD', 'AGGREGATE']);

/** FP age bands (women of reproductive age). */
export const FP_AGE_BANDS = Object.freeze(['10-14', '15-19', '20-49']);

/**
 * Compute whole-year age in years at a reference date (UTC-safe).
 * @param {string|null} birthDate  e.g. "2008-04-12"
 * @param {string} refDate         e.g. "2026-10-01"
 * @returns {number|null}
 */
export const ageYearsAt = (birthDate, refDate) => {
  if (!birthDate) return null;
  const b = new Date(String(birthDate).slice(0, 10) + 'T00:00:00Z');
  const r = new Date(String(refDate).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(b.getTime()) || Number.isNaN(r.getTime())) return null;
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
};

/**
 * Map an age (years) into an FP age band, or null when outside 10-49.
 * @param {number|null} age
 * @returns {'10-14'|'15-19'|'20-49'|null}
 */
export const fpAgeBand = (age) => {
  if (age == null) return null;
  if (age >= 10 && age <= 14) return '10-14';
  if (age >= 15 && age <= 19) return '15-19';
  if (age >= 20 && age <= 49) return '20-49';
  return null;
};

/**
 * Build an empty FP result shape.
 * @returns {{ '10-14': number, '15-19': number, '20-49': number, total: number }}
 */
export const emptyFpCounts = () => ({
  '10-14': 0,
  '15-19': 0,
  '20-49': 0,
  total: 0,
});

/**
 * Core person-based FP counter.
 *
 * Given a list of qualifying records (each already filtered to the reporting
 * barangay and reporting rule), count each UNIQUE person once in the age band
 * of their age at `refDate`, and sum into Total.
 *
 * @param {Array<{ resident_id?: string|null, birth_date?: string|null, sex?: string }>} records
 * @param {object} [opts]
 * @param {string} [opts.refDate]  reporting reference date (defaults to today)
 * @param {string} [opts.uniqueKey] key used for de-duplication (default resident_id)
 * @param {'Female'|'Male'|null} [opts.sexFilter] only count persons of this sex
 * @returns {{ counts: {'10-14':number,'15-19':number,'20-49':number,total:number}, uniqueIds: string[] }}
 */
export const countQualifyingPeopleByAge = (records = [], { refDate, uniqueKey = 'resident_id', sexFilter = null } = {}) => {
  const counts = emptyFpCounts();
  const uniqueIds = new Set();
  const reference = refDate || new Date().toISOString().slice(0, 10);
  for (const rec of records) {
    const id = rec[uniqueKey];
    if (!id) continue;
    // Barangay / sex / validity filtering is the CALLER's responsibility (the
    // caller passes only already-qualifying records); the sex filter here is
    // the only extra check we apply for WRA person indicators.
    if (sexFilter && rec.sex && String(rec.sex).toLowerCase() !== String(sexFilter).toLowerCase()) continue;
    if (uniqueIds.has(id)) continue; // never double-count the same person
    const age = ageYearsAt(rec.birth_date, reference);
    const band = fpAgeBand(age);
    if (!band) continue; // outside reproductive age -> not counted
    uniqueIds.add(id);
    counts[band] += 1;
    counts.total += 1;
  }
  return { counts, uniqueIds: [...uniqueIds] };
};

/**
 * Group a set of qualifying records by M1 method indicator code and run the
 * person-based counter for each. Each resident contributes to EVERY method
 * code their stored FP method maps to (a resident has one method, so normally
 * exactly one code).
 *
 * @param {Array<{ resident_id?: string, birth_date?: string, sex?: string, methodCodes: string[] }>} people
 * @param {object} [opts]  same opts as countQualifyingPeopleByAge
 * @returns {Record<string, { '10-14':number,'15-19':number,'20-49':number,total:number }>}
 */
export const countPeopleByMethod = (people = [], opts = {}) => {
  const byMethod = {};
  for (const p of people) {
    for (const code of p.methodCodes || []) {
      if (!byMethod[code]) byMethod[code] = [];
      byMethod[code].push(p);
    }
  }
  const out = {};
  for (const [code, records] of Object.entries(byMethod)) {
    out[code] = countQualifyingPeopleByAge(records, opts).counts;
  }
  return out;
};

/**
 * General-purpose unique-person counter with an optional age window and sex
 * filter, used by the derived person-level indicators that are not in the FP
 * age bands (e.g. senior citizens 60+ receiving PPV / influenza vaccine, or
 * TCL program enrollments). Each unique resident contributes at most +1.
 *
 * @param {Array<{ resident_id?: string|null, birth_date?: string|null, sex?: string }>} records
 * @param {object} [opts]
 * @param {string} [opts.refDate]   reporting reference date (defaults to today)
 * @param {string} [opts.uniqueKey] de-dup key (default resident_id)
 * @param {string|null} [opts.sexFilter] only count persons of this sex
 * @param {number|null} [opts.ageMin] minimum age in years at refDate (inclusive)
 * @param {number|null} [opts.ageMax] maximum age in years at refDate (inclusive)
 * @returns {{ total: number, uniqueIds: string[] }}
 */
export const countUniquePeople = (records = [], { refDate, uniqueKey = 'resident_id', sexFilter = null, ageMin = null, ageMax = null } = {}) => {
  const uniqueIds = new Set();
  const reference = refDate || new Date().toISOString().slice(0, 10);
  for (const rec of records || []) {
    const id = rec[uniqueKey];
    if (!id) continue;
    if (sexFilter && rec.sex && String(rec.sex).toLowerCase() !== String(sexFilter).toLowerCase()) continue;
    if (uniqueIds.has(id)) continue;
    const age = ageYearsAt(rec.birth_date, reference);
    if (ageMin != null && (age == null || age < ageMin)) continue;
    if (ageMax != null && (age == null || age > ageMax)) continue;
    uniqueIds.add(id);
  }
  return { total: uniqueIds.size, uniqueIds: [...uniqueIds] };
};

export default {
  COUNTING_UNITS,
  FP_AGE_BANDS,
  ageYearsAt,
  fpAgeBand,
  emptyFpCounts,
  countQualifyingPeopleByAge,
  countPeopleByMethod,
  countUniquePeople,
};