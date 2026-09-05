import ApiError from '../utils/apiError.js';

/** Require a server-resolved tenant assignment on protected organization data. */
export const resolveOrganizationScope = (req, res, next) => {
  const municipalityId = String(req.user?.municipalityId || '').trim();
  if (!municipalityId) return next(ApiError.forbidden('Your account has no municipality assignment'));

  const requested = String(req.query?.municipalityId || req.body?.municipalityId || '').trim();
  if (requested && requested !== municipalityId) {
    return next(ApiError.forbidden('Your account cannot access another municipality'));
  }

  req.organizationScope = {
    municipalityId,
    rhuId: req.user.rhuId || null,
    barangayId: req.user.barangayId || null,
  };
  return next();
};

export default resolveOrganizationScope;
