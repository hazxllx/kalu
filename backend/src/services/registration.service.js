import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { getServiceClient } from '../config/supabase.js';
import { validateDocumentUpload } from '../validators/documents.validators.js';

const SELF_ROLES = Object.freeze(['resident', 'resident-limited']);

const text = (value) => String(value ?? '').trim();

const validate = (payload) => {
  const errors = [];
  const firstName = text(payload.firstName);
  const lastName = text(payload.lastName);
  const birthDate = text(payload.birthDate);
  const sex = text(payload.sex);
  const barangay = text(payload.barangay);

  if (!firstName) errors.push('First name is required.');
  if (!lastName) errors.push('Last name is required.');
  if (!birthDate) errors.push('Date of birth is required.');
  else {
    const dob = new Date(birthDate);
    if (Number.isNaN(dob.getTime())) errors.push('Date of birth is invalid.');
    else if (dob.getTime() > Date.now()) errors.push('Date of birth cannot be in the future.');
  }
  if (!sex) errors.push('Sex is required.');
  else if (!['Male', 'Female'].includes(sex)) errors.push('Sex must be "Male" or "Female".');
  if (!barangay) errors.push('Barangay is required.');

  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  return { firstName, lastName, birthDate, sex, barangay };
};

export const registerResident = async ({ user, payload = {} }) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may complete resident registration.');
  }

  const existing = await repository.getResidentByAuthUserId(user.id);
  if (existing) {
    throw ApiError.conflict('A resident record is already linked to this account.');
  }

  const fields = validate(payload);

  const barangayRow = await repository.findBarangayByName(fields.barangay, user.municipalityId || null);
  if (!barangayRow) {
    throw ApiError.unprocessable(`Unknown barangay: ${fields.barangay}. Please select a valid barangay.`);
  }

  const duplicate = await repository.findResidentByIdentity({
    lastName: fields.lastName,
    firstName: fields.firstName,
    middleName: text(payload.middleName),
    birthDate: fields.birthDate,
  });
  if (duplicate) {
    throw ApiError.conflict(
      'A resident record matching these details already exists. Please visit your barangay health station for assistance.',
    );
  }

  const ids = await repository.nextResidentIds();

  const resident = await repository.insertResident({
    ...ids,
    authUserId: user.id,
    firstName: fields.firstName,
    middleName: text(payload.middleName),
    lastName: fields.lastName,
    suffix: text(payload.suffix),
    birthDate: fields.birthDate,
    birthPlace: text(payload.birthPlace),
    sex: fields.sex,
    civilStatus: text(payload.civilStatus),
    religion: text(payload.religion),
    employmentStatus: text(payload.employmentStatus),
    is4PsMember: Boolean(payload.is4PsMember),
    philhealthNo: text(payload.philhealthNo),
    currentAddress: text(payload.currentAddress),
    permanentAddress: text(payload.permanentAddress),
    cellphoneNo: text(payload.cellphoneNo),
    identityNo: text(payload.identityNo),
    barangay: barangayRow.name,
    verificationStatus: 'pending',
    submittedForVerificationAt: new Date().toISOString(),
    createdById: user.id,
    createdByRole: user.role,
  });

  const supabase = getServiceClient();
  try {
    await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
  } catch {
    /* best-effort: do not block registration if confirmation fails */
  }

  return {
    id: resident.id,
    healthRecordNo: resident.healthRecordNo,
    firstName: resident.firstName,
    lastName: resident.lastName,
    barangay: resident.barangay,
    verificationStatus: resident.verificationStatus || 'pending',
  };
};

export default { registerResident };
