/**
 * Medicine catalog endpoints.
 *
 *   GET    /medicines              search catalog by generic OR brand (clinical read)
 *   POST   /medicines              create a catalog entry (admin)
 *   PUT    /medicines/:id          edit a catalog entry (admin)
 *   PATCH  /medicines/:id/active   activate / deactivate (admin)
 *
 * Writes are admin-only (route authorize list + service guard) and audited.
 * Catalog reads are available to clinical roles so the consultation form can
 * search when prescribing. There is no stock/availability tracking.
 */
import * as medicines from '../services/medicines.service.js';
import { sendData } from '../utils/apiResponse.js';

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

export const create = async (req, res) => {
  const medicine = await medicines.createMedicine({ user: req.user, payload: req.body || {} });
  sendData(res, { medicine });
};

export const update = async (req, res) => {
  const medicine = await medicines.updateMedicine({ user: req.user, id: req.params.id, payload: req.body || {} });
  sendData(res, { medicine });
};

export const setActive = async (req, res) => {
  const medicine = await medicines.setMedicineActive({
    user: req.user,
    id: req.params.id,
    active: Boolean((req.body || {}).active),
  });
  sendData(res, { medicine });
};

export default { list, create, update, setActive };
