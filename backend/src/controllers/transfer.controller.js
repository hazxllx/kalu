import * as transferService from '../services/transfer.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

export const getContext = async (req, res) => sendData(res, await transferService.getContext({ user: req.user }));
export const startTransfer = async (req, res) => sendCreated(res, await transferService.startTransfer({ user: req.user, toBarangayId: req.body?.toBarangayId, reason: req.body?.reason }));
export const uploadDocument = async (req, res) => sendCreated(res, { document: await transferService.uploadDocument({ user: req.user, requestId: req.params.id, file: req.file, documentType: req.body?.documentType }) });
export const removeDocument = async (req, res) => sendData(res, await transferService.removeDocument({ user: req.user, requestId: req.params.id, documentId: req.params.documentId }));
export const getMine = async (req, res) => sendData(res, { transfer: await transferService.getMine({ user: req.user }) });
export const submit = async (req, res) => sendData(res, { transfer: await transferService.submit({ user: req.user, requestId: req.params.id }) });
export const cancel = async (req, res) => sendData(res, { transfer: await transferService.cancel({ user: req.user, requestId: req.params.id }) });
export const listQueue = async (req, res) => sendData(res, await transferService.listQueue({ user: req.user, status: req.query.status || 'pending' }));
export const getForReview = async (req, res) => sendData(res, await transferService.getForReview({ user: req.user, requestId: req.params.id }));
export const approve = async (req, res) => sendData(res, { transfer: await transferService.approve({ user: req.user, requestId: req.params.id }) });
export const reject = async (req, res) => sendData(res, { transfer: await transferService.reject({ user: req.user, requestId: req.params.id, reason: req.body?.reason }) });

export default { getContext, startTransfer, uploadDocument, removeDocument, getMine, submit, cancel, listQueue, getForReview, approve, reject };
