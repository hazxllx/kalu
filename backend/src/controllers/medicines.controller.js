/**
 * Medicine catalog controller for prescription lookup and admin formulary management.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> medicines.controller -> medicines.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET    /medicines              search catalog by generic OR brand (clinical read)
 *   POST   /medicines              create a catalog entry (admin)
 *   PUT    /medicines/:id          edit a catalog entry (admin)
 *   PATCH  /medicines/:id/active   activate / deactivate (admin)
 *
 * Writes are admin-only (route `authorize` list + service guard) and audited.
 * Catalog reads are available to clinical roles so the consultation form can
 * search when prescribing. There is no stock/availability tracking.
 */
import * as medicines from '../services/medicines.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Handles `GET /medicines` — searches the medicine formulary by `req.query.q`
 * (generic or brand name) and optional `req.query.source`. Only administrators
 * (`req.user.role === 'admin'`) may pass `includeInactive=true`; clinical roles
 * always receive active catalog entries only.
 * Delegates to `medicines.listMedicines()` and responds with `200 OK` (`{ medicines }`).
 *
 * @param {Object} req - Express request with `q`, `source`, and `includeInactive` query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const rows = await medicines.listMedicines({
    q: req.query.q || '',
    source: req.query.source || '',
    // Only admins may list deactivated entries; clinical reads see active only.
    includeInactive: isAdmin && String(req.query.includeInactive) === 'true',
  });
  sendData(res, { medicines: rows });
};

/**
 * Handles `POST /medicines` — creates a new medicine catalog entry from `req.body`
 * as admin `req.user` via `medicines.createMedicine()`.
 * Responds with `200 OK` (`{ medicine }`) via `sendData`.
 *
 * @param {Object} req - Express request with medicine fields in `body` and admin `user`.
 * @param {Object} res - Express response.
 */
export const create = async (req, res) => {
  const medicine = await medicines.createMedicine({ user: req.user, payload: req.body || {} });
  sendData(res, { medicine });
};

/**
 * Handles `PUT /medicines/:id` — updates medicine catalog entry `req.params.id`
 * with fields from `req.body` as admin `req.user` via `medicines.updateMedicine()`.
 * Responds with `200 OK` (`{ medicine }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, medicine fields in `body`, and admin `user`.
 * @param {Object} res - Express response.
 */
export const update = async (req, res) => {
  const medicine = await medicines.updateMedicine({ user: req.user, id: req.params.id, payload: req.body || {} });
  sendData(res, { medicine });
};

/**
 * Handles `PATCH /medicines/:id/active` — toggles the active flag of medicine
 * catalog entry `req.params.id` using coerced boolean `req.body.active` via
 * `medicines.setMedicineActive()`. Responds with `200 OK` (`{ medicine }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id`, `{ active }` in `body`, and admin `user`.
 * @param {Object} res - Express response.
 */
export const setActive = async (req, res) => {
  const medicine = await medicines.setMedicineActive({
    user: req.user,
    id: req.params.id,
    active: Boolean((req.body || {}).active),
  });
  sendData(res, { medicine });
};

export default { list, create, update, setActive };
