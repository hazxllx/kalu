import * as consultationsService from '../services/consultations.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';

export const list = async (req, res) => {
  // Server-side consultation history filters (date range / health service /
  // consultation status). Validated here so an invalid range or unknown status
  // is a 422 with a clear message instead of a silently ignored filter.
  const { filters, errors } = consultationsService.parseListFilters({
    from: req.query.from,
    to: req.query.to,
    serviceId: req.query.serviceId ?? req.query.service_id,
    status: req.query.status,
  });
  if (errors.length) {
    throw ApiError.unprocessable('Please correct the consultation filters.', errors);
  }
  sendData(res, await consultationsService.list({ user: req.user, q: req.query.q, filters }));
};
export const create = async (req, res) => sendCreated(res, { consultation: await consultationsService.create({ user: req.user, payload: req.body?.consultation || req.body || {} }) });
export const update = async (req, res) => sendData(res, { consultation: await consultationsService.update({ user: req.user, id: req.params.id, payload: req.body?.consultation || req.body || {} }) });

export default { list, create, update };