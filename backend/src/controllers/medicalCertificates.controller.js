import {
  CERT_PURPOSES,
  CERT_STATUSES,
  ALLOWED_TRANSITIONS,
  nextReference,
} from '../services/medicalCertificates.service.js';
import * as service from '../services/medicalCertificates.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Medical certificate endpoints.
 *
 *   GET  /meta                     status vocabulary, purposes and transitions
 *   GET  /next-reference           next MC-YYYY-#### number
 *   GET  /?status=&residentId=     certificates in the caller's scope
 *   GET  /:id                      one certificate + its decision history
 *   POST /                         prepare a certificate (Draft)
 *   PUT  /:id                      edit the document fields
 *   PATCH /:id/status              submit / approve / issue / reject / cancel
 */

export const meta = async (req, res) => {
  sendData(res, {
    statuses: CERT_STATUSES,
    purposes: CERT_PURPOSES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    canDecide: service.canDecide(req.user),
  });
};

export const reference = async (req, res) => {
  const referenceNo = await nextReference();
  sendData(res, { reference: referenceNo });
};

export const list = async (req, res) => {
  const rows = await service.list({
    user: req.user,
    status: req.query.status,
    residentId: req.query.residentId,
  });
  sendData(res, { rows, records: rows });
};

export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

export const update = async (req, res) => {
  const record = await service.update({ user: req.user, id: req.params.id, payload: req.body || {} });
  sendData(res, { record });
};

export const changeStatus = async (req, res) => {
  const record = await service.changeStatus({
    user: req.user,
    id: req.params.id,
    status: req.body?.status,
    notes: req.body?.notes,
  });
  sendData(res, { record });
};

export default { meta, reference, list, get, create, update, changeStatus };
