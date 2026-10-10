/**
 * Medicine catalog endpoints.
 *
 *   GET    /medicines                      search catalog (clinical read)
 *   POST   /medicines                      create a catalog entry (admin)
 *   PUT    /medicines/:id                  edit a catalog entry (admin)
 *   PATCH  /medicines/:id/active           activate / deactivate (admin)
 *   GET    /medicines/:id/availability     per-facility availability (read)
 *   PUT    /medicines/:id/availability     set facility availability (admin)
 *
 * Writes are admin-only (route authorize list + service guard) and audited.
 * Catalog reads are available to clinical roles so the consultation form can
 * search when prescribing.
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
    facilityId: req.query.facilityId || '',
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

export const listAvailability = async (req, res) => {
  const availability = await medicines.listAvailability({ id: req.params.id });
  sendData(res, { availability });
};

export const facilities = async (req, res) => {
  const rows = await medicines.listFacilities({ user: req.user });
  sendData(res, { facilities: rows });
};

export const setAvailability = async (req, res) => {
  const body = req.body || {};
  const availability = await medicines.setAvailability({
    user: req.user,
    id: req.params.id,
    facilityId: body.facilityId,
    available: body.available === undefined ? true : Boolean(body.available),
    note: body.note || '',
  });
  sendData(res, { availability });
};

export default { list, create, update, setActive, listAvailability, setAvailability, facilities };
