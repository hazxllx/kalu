import * as service from '../services/visitPlans.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * Resident visit-plan endpoints (resident self-service).
 *
 * Ownership and barangay/RHU scope are always derived from the authenticated
 * session in the service layer — the controller never passes a client-supplied
 * resident id, and the plan id in the URL is only ever matched against the
 * caller's own resident record. No appointment status is ever exposed.
 */

// GET /resident/health-services — services grouped by facility (BHC + RHU).
export const directory = async (req, res) =>
  sendData(res, await service.listDirectory({ user: req.user }));

// GET /resident/health-services/:id/availability?from=&to=
export const availability = async (req, res) =>
  sendData(res, {
    availability: await service.serviceAvailability({
      user: req.user,
      serviceId: req.params.id,
      from: req.query?.from,
      to: req.query?.to,
    }),
  });

// POST /resident/visit-plans
export const create = async (req, res) => {
  const result = await service.createPlan({
    user: req.user,
    serviceId: req.body.serviceId,
    plannedDate: req.body.plannedDate,
    note: req.body.note,
  });
  return sendCreated(res, result);
};

// DELETE /resident/visit-plans/:id
export const remove = async (req, res) =>
  sendData(res, await service.removePlan({ user: req.user, id: req.params.id }));

// GET /resident/visit-plans?service_id=
export const list = async (req, res) =>
  sendData(res, { rows: await service.listOwnPlans({ user: req.user, serviceId: req.query?.serviceId }) });

export default { directory, availability, create, remove, list };
