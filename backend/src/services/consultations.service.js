import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { assignedBarangay } from '../config/scope.js';

const STAFF_ROLES = new Set(['health_supervisor', 'phn']);
const text = (value) => String(value ?? '').trim();

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
  const ids = await repository.nextSubmissionId();
  const visit = await repository.insertVisit({ id: ids.id, ...toVisit(payload, user, resident.id) });
  return fromVisit(visit);
};

export const update = async ({ user, id, payload = {} }) => {
  assertStaff(user);
  const visit = await repository.getVisit(id);
  if (!visit) throw ApiError.notFound('Consultation not found.');
  assertResidentScope(user, visit.resident);
  const updated = await repository.updateVisit(id, toVisit({ ...payload, residentId: visit.residentId }, user, visit.residentId));
  return fromVisit(updated);
};

export default { list, create, update };