const text = (value) => String(value ?? '').trim();
const value = (field) => field === null || field === undefined ? '' : String(field);
const fields = ['chiefComplaint', 'findings', 'diagnosis', 'treatmentGiven', 'medicationPrescribed', 'adviceGiven', 'remarks', 'followUpRequired', 'nextVisitDate', 'referralRequired'];
const vitals = { bloodPressure: 'bp', temperature: 'temperature', pulseRate: 'hr', respiratoryRate: 'rr', height: 'heightCm', weight: 'weightKg', oxygenSaturation: 'o2sat' };

export const consultationForm = (record = null, now = new Date()) => {
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(' ');
  const form = {
    residentId: value(record?.resident?.id || record?.residentId),
    consultationDate: record?.consultationDate ?? local[0],
    consultationTime: record?.consultationTime ?? local[1],
    followUpRequired: 'No', referralRequired: 'No',
    medications: (record?.medications || []).map((medication) => ({ ...medication })),
  };
  fields.forEach((field) => { form[field] = value(record?.[field] ?? form[field]); });
  Object.entries(vitals).forEach(([field, key]) => { form[field] = value(record?.vitals?.[key]); });
  return form;
};

export const clinicalPayload = (form, original = null) => {
  const payload = {
    residentId: text(form.residentId),
    consultationDate: form.consultationDate,
    consultationTime: form.consultationTime,
    serviceId: original?.serviceId || null,
    medications: (form.medications || []).map((medication) => ({ ...medication })),
    consultationDetails: { ...(original?.consultationDetails || {}) },
  };
  fields.forEach((field) => { payload[field] = text(form[field]); });
  Object.keys(vitals).forEach((field) => { payload[field] = text(form[field]); });
  if (original?.recordedAt) payload.recordedAt = original.recordedAt;
  if (original?.clientOperationKey) payload.clientOperationKey = original.clientOperationKey;
  return payload;
};

export const clinicalErrors = (payload) => {
  const errors = {};
  const date = payload.consultationDate;
  if (!payload.residentId) errors.residentId = 'Select a resident from the authorized registry.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) errors.consultationDate = 'Enter a valid encounter date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.consultationTime || '')) errors.consultationTime = 'Enter a valid encounter time.';
  if (!payload.chiefComplaint) errors.chiefComplaint = 'Chief complaint is required.';
  if (payload.bloodPressure && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(payload.bloodPressure)) errors.bloodPressure = 'Use systolic/diastolic, for example 120/80.';
  for (const field of Object.keys(vitals).filter((key) => key !== 'bloodPressure')) {
    if (payload[field] !== '' && (!Number.isFinite(Number(payload[field])) || Number(payload[field]) < 0)) errors[field] = 'Enter a valid non-negative number or leave this optional vital blank.';
  }
  if (payload.oxygenSaturation && Number(payload.oxygenSaturation) > 100) errors.oxygenSaturation = 'Oxygen saturation cannot exceed 100%.';
  if (payload.followUpRequired === 'Yes' && (!/^\d{4}-\d{2}-\d{2}$/.test(payload.nextVisitDate) || !Number.isFinite(Date.parse(`${payload.nextVisitDate}T00:00:00Z`)) || new Date(`${payload.nextVisitDate}T00:00:00Z`).toISOString().slice(0, 10) !== payload.nextVisitDate || payload.nextVisitDate < date)) errors.nextVisitDate = 'Set a valid follow-up date on or after the encounter.';
  if (payload.medications.some((medication) => !text(medication.genericName) || (medication.quantity !== undefined && medication.quantity !== '' && (!Number.isFinite(Number(medication.quantity)) || Number(medication.quantity) < 0)))) errors.medications = 'Every prescription needs a recorded medicine name and a valid quantity.';
  return errors;
};

export const requireServerConsultation = (response, expectedId = null) => {
  const record = response?.consultation;
  if (!record?.id || !(record.resident?.id || record.residentId) || !record.consultationDate || (expectedId !== null && String(record.id) !== String(expectedId))) {
    throw new Error('The server did not confirm the complete consultation. Reload the record before retrying.');
  }
  return record;
};
