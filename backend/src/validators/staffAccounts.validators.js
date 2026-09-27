import { REQUESTABLE_ROLES } from '../config/staffApprovals.js';
import { isUuid, text, valid, invalid } from './common.js';

/**
 * Staff account registration + verification request validation.
 *
 * The applicant's identity, the approving officer and the decision outcome are
 * never accepted from the client beyond the request payload itself: the
 * reviewer always comes from the authenticated session and the resulting
 * `profiles` row is written by the service, not by the browser.
 */

const LIMITS = { short: 80, notes: 2000 };

const clean = (value, max) => text(value).slice(0, max);

export const registerPersonnelValidator = (input = {}) => {
  const errors = {};

  const fullName = clean(input?.fullName, LIMITS.short);
  const email = text(input?.email).toLowerCase();
  const phone = clean(input?.phone, 30);
  const position = clean(input?.position, LIMITS.short);
  const licenseNo = clean(input?.licenseNo, LIMITS.short);
  const licenseExpiry = text(input?.licenseExpiry);
  const role = text(input?.role);
  // Assignment may arrive as a UUID or as the canonical name the registration
  // form knows. Names are resolved to ids server-side in
  // `resolveAssignment` so the client never needs reference-table ids.
  const barangayId = text(input?.barangayId);
  const facilityId = text(input?.facilityId);
  const barangay = clean(input?.barangay, LIMITS.short);
  const facility = clean(input?.facility, LIMITS.short);
  const password = typeof input?.password === 'string' ? input.password : '';

  if (!fullName) errors.fullName = 'Full name is required.';
  if (!email) errors.email = 'Email address is required.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';

  if (!password) errors.password = 'A password is required.';
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Password must contain at least one letter and one number.';
  }

  if (!role) errors.role = 'Select the role you are applying for.';
  else if (!REQUESTABLE_ROLES.includes(role)) {
    errors.role = 'That role is not an operational health personnel role.';
  }

  if (barangayId && !isUuid(barangayId)) errors.barangayId = 'The selected barangay is not valid.';
  if (facilityId && !isUuid(facilityId)) errors.facilityId = 'The selected facility is not valid.';

  if (licenseExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
    errors.licenseExpiry = 'License expiry must be a valid date.';
  }

  // Documents may be structured records (id) or a plain label line from the
  // upload component. Only the label is persisted, never file contents.
  const documents = Array.isArray(input?.documents)
    ? input.documents
        .slice(0, 20)
        .map((d) =>
          typeof d === 'string'
            ? { type: clean(d.split('—')[0], LIMITS.short), name: clean(d, LIMITS.short), path: '' }
            : {
                type: clean(d?.type, LIMITS.short),
                name: clean(d?.name, LIMITS.short),
                path: clean(d?.path, 400),
              },
        )
        .filter((d) => d.name)
    : [];

  if (Object.keys(errors).length) return invalid(errors);

  return valid({
    fullName,
    email,
    phone,
    position,
    licenseNo,
    licenseExpiry: licenseExpiry || null,
    role,
    barangayId: barangayId || null,
    facilityId: facilityId || null,
    barangay,
    facility,
    password,
    documents,
  });
};

export const staffAccountIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'An account request reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The account request reference is not valid.' });
  return valid({ ...params, id });
};

export const staffAccountDecisionValidator = (input = {}) => {
  const errors = {};
  const reason = text(input?.reason);
  const remarks = clean(input?.remarks, LIMITS.notes);

  if (reason && reason.length < 5) errors.reason = 'Please provide a more specific reason (at least 5 characters).';
  if (Object.keys(errors).length) return invalid(errors);

  return valid({ reason, remarks });
};

export default {
  registerPersonnelValidator,
  staffAccountIdParamValidator,
  staffAccountDecisionValidator,
};
