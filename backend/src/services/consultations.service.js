import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { assignedBarangay } from '../config/scope.js';
import { getServiceClient } from '../config/supabase.js';
import * as operational from './operational.service.js';

const STAFF_ROLES = new Set(['health_supervisor', 'phn']);
const text = (value) => String(value ?? '').trim();

/**
 * Server-side consultation vitals validation (issue #14).
 *
 * HTML input constraints are not security; a direct API call can send negative,
 * absurd or malformed values. Every vital is OPTIONAL, but when present it must
 * be a plausible clinical value. This is data-integrity validation, not medical
 * diagnosis. Pure + exported for unit testing; returns a list of error strings.
 */
const inRange = (value, lo, hi) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= lo && n <= hi;
};
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export const validateVitals = (payload = {}) => {
  const errors = [];
  const check = (field, label, lo, hi) => {
    if (!present(payload[field])) return;
    if (!inRange(payload[field], lo, hi)) errors.push(`${label} must be between ${lo} and ${hi}.`);
  };
  check('temperature', 'Temperature (°C)', 30, 45);
  check('pulseRate', 'Pulse rate (bpm)', 20, 250);
  check('respiratoryRate', 'Respiratory rate (breaths/min)', 5, 80);
  check('height', 'Height (cm)', 30, 250);
  check('weight', 'Weight (kg)', 1, 400);
  check('oxygenSaturation', 'Oxygen saturation (%)', 50, 100);

  if (present(payload.bloodPressure)) {
    const m = text(payload.bloodPressure).match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) {
      errors.push('Blood pressure must be in the form systolic/diastolic (e.g. 120/80).');
    } else {
      const sys = Number(m[1]);
      const dia = Number(m[2]);
      if (!inRange(sys, 50, 300)) errors.push('Systolic blood pressure must be between 50 and 300.');
      else if (!inRange(dia, 30, 200)) errors.push('Diastolic blood pressure must be between 30 and 200.');
      else if (sys <= dia) errors.push('Systolic blood pressure must be greater than diastolic.');
    }
  }
  return errors;
};

/**
 * Follow-up date consistency for a consultation (issue #15).
 *   - follow_up_required = true  -> a valid next_visit_date is required;
 *   - follow_up_required = false -> next_visit_date must be empty;
 *   - a next visit date must be a valid date on/after the consultation date.
 * Returns { errors, normalized } where normalized carries a cleaned nextVisitDate.
 */
export const validateFollowUp = (payload = {}) => {
  const errors = [];
  const raw = String(payload.followUpRequired ?? '').trim().toLowerCase();
  const required = raw === 'yes' || raw === 'true' || payload.followUpRequired === true;
  const explicitlyNotRequired = raw === 'no' || raw === 'false' || payload.followUpRequired === false;
  const nextVisit = text(payload.nextVisitDate);

  if (nextVisit) {
    if (Number.isNaN(Date.parse(nextVisit))) {
      errors.push('Next visit date is invalid.');
    } else if (present(payload.consultationDate) && !Number.isNaN(Date.parse(text(payload.consultationDate)))) {
      if (nextVisit < text(payload.consultationDate)) {
        errors.push('Next visit date cannot be before the consultation date.');
      }
    }
  }
  if (required && !nextVisit) {
    errors.push('A next visit date is required when a follow-up is required.');
  }
  // Contradiction: follow-up explicitly not required but a next visit date given.
  const normalized = { nextVisitDate: explicitlyNotRequired ? '' : nextVisit };
  return { errors, normalized };
};

const assertStaff = (user) => {
  if (!STAFF_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to manage consultations.');
};

const assertResidentScope = (user, resident) => {
  if (!resident) throw ApiError.notFound('Resident record not found.');
  const barangay = assignedBarangay(user);
  if (barangay && text(resident.barangay).toLowerCase() !== text(barangay).toLowerCase()) {
    throw ApiError.notFound('Resident record not found.');
  }
  if (user.municipalityId && resident.municipalityId && user.municipalityId !== resident.municipalityId) {
    throw ApiError.notFound('Resident record not found.');
  }
};

const toVisit = (payload = {}, user, residentId) => ({
  residentId,
  recordedById: user.id,
  recordedByRole: user.role,
  recordedByName: user.name || user.email || '',
  status: 'completed',
  visitDate: payload.consultationDate
    ? `${payload.consultationDate}${payload.consultationTime ? `T${payload.consultationTime}:00` : 'T00:00:00'}`
    : new Date().toISOString(),
  chiefComplaint: text(payload.chiefComplaint),
  clinicalHistory: text(payload.remarks),
  findings: [text(payload.findings), text(payload.diagnosis)].filter(Boolean).join('\nDiagnosis: '),
  treatmentGiven: [text(payload.treatmentGiven), text(payload.medicationPrescribed)].filter(Boolean).join('\nMedication: '),
  recommendation: [text(payload.adviceGiven), payload.nextVisitDate ? `Next visit: ${payload.nextVisitDate}` : ''].filter(Boolean).join('\n'),
  vitals: {
    bp: text(payload.bloodPressure),
    temperature: payload.temperature,
    hr: payload.pulseRate,
    rr: payload.respiratoryRate,
    heightCm: payload.height,
    weightKg: payload.weight,
    o2sat: payload.oxygenSaturation,
  },
  phn: {
    assessment: text(payload.diagnosis),
    notes: text(payload.remarks),
  },
});

const fromVisit = (visit) => {
  const resident = visit.resident || {};
  const findings = text(visit.findings);
  const diagnosisMarker = '\nDiagnosis: ';
  const [findingsText, diagnosis] = findings.includes(diagnosisMarker)
    ? findings.split(diagnosisMarker)
    : [findings, visit.phn?.assessment || ''];
  return {
    id: visit.id,
    resident: {
      id: resident.id || visit.residentId,
      name: [resident.firstName, resident.middleName, resident.lastName].filter(Boolean).join(' '),
      barangay: resident.barangay || '',
      sex: resident.sex || '',
      contact: resident.cellphoneNo || '',
      age: resident.birthDate ? Math.max(0, new Date().getFullYear() - new Date(resident.birthDate).getFullYear()) : '',
      program: 'General',
    },
    consultationDate: visit.visitDate ? String(visit.visitDate).slice(0, 10) : '',
    consultationTime: visit.visitDate?.includes('T') ? String(visit.visitDate).slice(11, 16) : '',
    chiefComplaint: visit.chiefComplaint || '',
    findings: findingsText,
    diagnosis: text(diagnosis),
    treatmentGiven: visit.treatmentGiven || '',
    medicationPrescribed: '',
    adviceGiven: visit.recommendation || '',
    remarks: visit.clinicalHistory || visit.phn?.notes || '',
    followUpRequired: visit.recommendation?.includes('Next visit:') ? 'Yes' : 'No',
    nextVisitDate: visit.recommendation?.match(/Next visit:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '',
    vitals: visit.vitals || {},
    status: visit.status,
    createdAt: visit.createdAt,
  };
};

const TERMINAL_FOLLOWUP = new Set(['Completed', 'Cancelled', 'Rejected']);

/** Purpose label a consultation follow-up is stored under (also the resident-facing "Reason"). */
const followUpPurpose = (payload = {}) =>
  `${text(payload.chiefComplaint) || text(payload.diagnosis) || 'Consultation'} follow-up`;

/**
 * Pure decision for how to reconcile a consultation's follow-up with any LIVE
 * (non-terminal) follow-up already recorded for this consultation. Exported for
 * unit testing.
 *
 *   wants + none                                 -> 'create'     (new, awaiting resident confirmation)
 *   wants + live, resident already approved      -> 'reschedule' (keep confirmed, move the date)
 *   wants + live, not yet decided                -> 'await'      (assert awaiting-confirmation state)
 *   not wanted + live follow-up                  -> 'cancel'     (history preserved)
 *   otherwise                                    -> 'noop'
 */
export const planFollowUpSync = (existing, payload = {}) => {
  const wants = Boolean(text(payload.nextVisitDate));
  const live = existing && !TERMINAL_FOLLOWUP.has(text(existing.status));
  if (wants) {
    if (!live) return { action: 'create' };
    return { action: text(existing.resident_decision) === 'approved' ? 'reschedule' : 'await' };
  }
  if (live) return { action: 'cancel' };
  return { action: 'noop' };
};

/**
 * Keep exactly ONE follow-up in sync with a consultation's
 * "Follow-up Required / Next Visit Date".
 *
 * The follow-up is the SAME canonical `follow_ups` record the resident already
 * reads (My Follow-ups + Schedule Calendar) and staff manage — there is no
 * second follow-up system. It is owned by the SAME resident as the consultation
 * (resident_id = visit.residentId).
 *
 * A consultation follow-up REQUIRES the resident to confirm/reject: it lives in
 * the existing "awaiting resident response" state (status 'Pending',
 * requires_resident_response = true, resident_decision 'pending'), which the
 * resident page renders with Confirm/Reject. New rows are created through the
 * existing operational service (audit + "requires your response" notification);
 * a still-undecided existing row is re-asserted into that state (this also
 * upgrades older rows that were created before confirmation was required); a row
 * the resident has already approved is only rescheduled, never reset.
 *
 * De-duplication uses ONLY columns already in the deployed schema (resident_id +
 * created_by + purpose, restricted to a live/non-terminal follow-up), so a later
 * edit updates that one row instead of duplicating. No migration is required.
 *
 * BEST-EFFORT: a follow-up bookkeeping failure is logged but never propagates,
 * so a clinical consultation save is never rejected because of the follow-up
 * step. (Injectable deps are for unit testing only.)
 */
export const syncConsultationFollowUp = async ({
  user,
  visit,
  payload,
  supabase = getServiceClient(),
  ops = operational,
}) => {
  if (!visit?.id || !visit?.residentId) return;
  try {
    const purpose = followUpPurpose(payload);
    // Find a live follow-up already recorded for this resident+consultation by
    // this staff member. Terminal (Completed/Cancelled/Rejected) rows are left
    // as history, so a new one is created instead of resurrecting them.
    const { data: rows, error } = await supabase
      .from('follow_ups')
      .select('id, status, resident_decision')
      .eq('resident_id', visit.residentId)
      .eq('created_by', user.id)
      .eq('purpose', purpose)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not look up the linked follow-up');
    const existing = (rows || []).find((r) => !TERMINAL_FOLLOWUP.has(text(r.status))) || null;

    const { action } = planFollowUpSync(existing, payload);
    if (action === 'noop') return;

    if (action === 'await') {
      // Assert the awaiting-confirmation state so the resident gets Confirm /
      // Reject. Confirmation columns are resident-owned and not settable through
      // the staff operational update, so this one field-set is written directly
      // on the already-resolved own row (ownership: resident_id + created_by).
      const { error: upErr } = await supabase
        .from('follow_ups')
        .update({
          scheduled_date: text(payload.nextVisitDate),
          purpose,
          notes: text(payload.adviceGiven),
          status: 'Pending',
          requires_resident_response: true,
          resident_decision: 'pending',
          resident_decision_at: null,
          resident_decision_reason: '',
        })
        .eq('id', existing.id);
      if (upErr) throw new Error(upErr.message || 'Could not update the follow-up');
      return;
    }

    if (action === 'reschedule') {
      // Resident already confirmed — keep it confirmed, just move the date.
      await ops.update({
        user,
        kind: 'followups',
        id: existing.id,
        payload: { scheduled_date: text(payload.nextVisitDate), purpose, notes: text(payload.adviceGiven) },
      });
      return;
    }

    if (action === 'cancel') {
      await ops.update({ user, kind: 'followups', id: existing.id, payload: { status: 'Cancelled' } });
      return;
    }

    // action === 'create'
    await ops.create({
      user,
      kind: 'followups',
      payload: {
        residentId: visit.residentId,
        scheduled_date: text(payload.nextVisitDate),
        purpose,
        notes: text(payload.adviceGiven),
        assigned_provider: text(user.name) || text(user.email),
        // Enter the EXISTING "awaiting resident response" workflow: shows on My
        // Follow-ups as "Action Required" with Confirm/Reject; the resident's
        // decision moves it to Scheduled (approved) or Cancelled (rejected).
        requiresResidentResponse: true,
      },
    });
  } catch (err) {
    // Best-effort: never fail the consultation save because of the follow-up.
    // eslint-disable-next-line no-console
    console.error(`syncConsultationFollowUp: ${err?.message || err}`);
  }
};

export const list = async ({ user, q = '' }) => {
  assertStaff(user);
  const result = await repository.listVisits({ q: text(q), limit: 200 });
  const rows = result.rows.filter((visit) => {
    try { assertResidentScope(user, visit.resident); return true; } catch { return false; }
  });
  return { rows: rows.map(fromVisit), total: rows.length };
};

export const create = async ({ user, payload = {} }) => {
  assertStaff(user);
  const resident = await repository.getResident(payload.residentId);
  assertResidentScope(user, resident);
  if (!payload.consultationDate || !text(payload.chiefComplaint) || !text(payload.findings) || !text(payload.diagnosis)) {
    throw ApiError.unprocessable('Resident, consultation date, chief complaint, findings, and diagnosis are required.');
  }
  const vitalErrors = validateVitals(payload);
  const { errors: followUpErrors, normalized } = validateFollowUp(payload);
  const allErrors = [...vitalErrors, ...followUpErrors];
  if (allErrors.length) throw ApiError.unprocessable('Please correct the highlighted consultation values.', allErrors);
  const cleanPayload = { ...payload, nextVisitDate: normalized.nextVisitDate };
  const ids = await repository.nextSubmissionId();
  const visit = await repository.insertVisit({ id: ids.id, ...toVisit(cleanPayload, user, resident.id) });
  // Create the linked follow-up (own resident) when a Next Visit Date is set.
  await syncConsultationFollowUp({ user, visit, payload: cleanPayload });
  return fromVisit(visit);
};

export const update = async ({ user, id, payload = {} }) => {
  assertStaff(user);
  const visit = await repository.getVisit(id);
  if (!visit) throw ApiError.notFound('Consultation not found.');
  assertResidentScope(user, visit.resident);
  const vitalErrors = validateVitals(payload);
  const { errors: followUpErrors, normalized } = validateFollowUp(payload);
  const allErrors = [...vitalErrors, ...followUpErrors];
  if (allErrors.length) throw ApiError.unprocessable('Please correct the highlighted consultation values.', allErrors);
  const cleanPayload = { ...payload, nextVisitDate: normalized.nextVisitDate, residentId: visit.residentId };
  const updated = await repository.updateVisit(id, toVisit(cleanPayload, user, visit.residentId));
  // Create / reschedule / cancel the linked follow-up to match the edited form.
  await syncConsultationFollowUp({ user, visit: updated, payload: cleanPayload });
  return fromVisit(updated);
};

export default { list, create, update };