import { SERVICE_CATEGORIES } from '../services/healthServices.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * Health service request validation. Municipality/barangay scope is taken from
 * the authenticated session in the service (a Health Supervisor is forced to
 * their own barangay), so only content + optional facility/barangay/personnel
 * references are accepted here.
 */

const LIMITS = { name: 160, description: 2000 };

export const createServiceValidator = (input = {}) => {
  const errors = {};
  const name = text(input?.name);
  if (!name) errors.name = 'A service name is required.';
  if (name.length > LIMITS.name) errors.name = 'The service name is too long.';

  const category = text(input?.category);
  if (category && !SERVICE_CATEGORIES.includes(category)) errors.category = 'Select a valid service category.';

  const facilityId = text(input?.facilityId || input?.facility_id);
  const barangayId = text(input?.barangayId || input?.barangay_id);
  if (facilityId && !isUuid(facilityId)) errors.facilityId = 'The selected facility is not valid.';
  if (barangayId && !isUuid(barangayId)) errors.barangayId = 'The selected barangay is not valid.';

  const personnelIdsRaw = Array.isArray(input?.personnelIds) ? input.personnelIds : [];
  const personnelIds = personnelIdsRaw.map((p) => text(p)).filter(Boolean);
  if (personnelIds.some((p) => !isUuid(p))) errors.personnelIds = 'One or more selected personnel are not valid.';

  if (Object.keys(errors).length) return invalid(errors);
  return valid({
    name,
    category: category || 'Other',
    description: text(input?.description).slice(0, LIMITS.description),
    facilityId: facilityId || null,
    barangayId: barangayId || null,
    personnelIds,
    active: input?.active === false ? false : true,
  });
};

export const assignValidator = (input = {}) => {
  const personnelId = text(input?.personnelId || input?.personnel_id);
  if (!personnelId) return invalid({ personnelId: 'Select a personnel to assign.' });
  if (!isUuid(personnelId)) return invalid({ personnelId: 'The selected personnel is not valid.' });
  return valid({ personnelId });
};

export const serviceIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A service reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The service reference is not valid.' });
  return valid({ ...params, id });
};

export default { createServiceValidator, assignValidator, serviceIdParamValidator };
